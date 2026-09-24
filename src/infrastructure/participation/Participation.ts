/**
 * Adaptadores de participación: canales propios de difusión, tarjetas y tiempo real.
 */
import { createHmac, randomUUID } from "node:crypto";
import type { Campaign, CampaignPiece, CampaignPieceKind, RoomEvent, User } from "../../domain/model";
import type { IAlertRuleRepository, IAssetGenerator, ICampaignChannel, IHttpClient, IRealtimeTransport, IUserRepository } from "../../domain/ports";
import type { AccessControl } from "../../application/access/AccessControl";
import type { NotificationService } from "../../application/messaging/NotificationService";

/**
 * Seguidores del tema: personas que configuraron alertas sobre ese tema (aceptaron avisos).
 * Pasa por las reglas de cumplimiento de cada canal (bajas, plantillas, frecuencia).
 */
export class TopicFollowersChannel implements ICampaignChannel {
  readonly id = "seguidores_del_tema";
  readonly label = "Personas que siguen el tema";
  readonly accepts: CampaignPieceKind[] = ["short_text"];

  constructor(
    private readonly alerts: IAlertRuleRepository,
    private readonly users: IUserRepository,
    private readonly access: AccessControl,
    private readonly notifications: NotificationService,
    private readonly whatsappTemplate = "campana_dato_verificado",
    /** Preferencias: quienes siguen el tema y quienes silenciaron su categoría. */
    private readonly prefs?: { followers(topic: string): Promise<string[]>; isMuted(user: User, topic: string): Promise<boolean> },
  ) {}

  async publish(c: Campaign, piece: CampaignPiece) {
    if (!c.topic) return { ok: false, reach: 0, error: "La campaña no tiene tema: no hay seguidores a quienes avisar." };
    const rules = await this.alerts.findActiveByTopic(c.topic);
    const byUser = new Map(rules.map((r) => [r.userId, r.channel]));
    const content = { kind: "info" as const, title: piece.title, summary: piece.text, sections: [], links: c.message.links, footer: `Campaña de ${c.sponsor}` };
    let reach = 0;
    for (const [userId, channel] of byUser) {
      const u = await this.users.findById(userId);
      if (!u || u.status !== "active") continue;
      if (await this.prefs?.isMuted(u, c.topic)) continue;
      const { plan } = await this.access.planOf(u);
      const address = u.channels.find((x) => x.channel === channel && x.verified)?.address;
      if (!address || !plan.channels.includes(channel)) continue;
      // Por el mismo canal que la persona eligió para sus avisos del tema.
      // En WhatsApp, como plantilla aprobada (puede estar fuera de la ventana de 24 h).
      const template = channel === "whatsapp" ? { template: { name: this.whatsappTemplate, language: "es_AR", params: [c.sponsor, piece.title, c.message.links[0]?.url ?? ""] } } : {};
      const r = await this.notifications.sendTo(channel, address, content, "notification", template);
      if (r.ok) reach++;
    }
    // Quienes siguen el tema desde sus preferencias (sin alerta): por su canal preferido,
    // respetando su horario de silencio.
    for (const userId of (await this.prefs?.followers(c.topic)) ?? []) {
      if (byUser.has(userId)) continue;
      const u = await this.users.findById(userId);
      if (!u || u.status !== "active" || (await this.prefs!.isMuted(u, c.topic))) continue;
      const { plan } = await this.access.planOf(u);
      const tpl = { name: this.whatsappTemplate, language: "es_AR", params: [c.sponsor, piece.title, c.message.links[0]?.url ?? ""] };
      const r = await this.notifications.notifyUser(u, content, plan.channels, tpl);
      if (r.ok) reach++;
    }
    return { ok: true, reach };
  }
}

/** Canal de Telegram de la organización (el bot tiene que ser administrador del canal). */
export class TelegramBroadcastChannel implements ICampaignChannel {
  readonly accepts: CampaignPieceKind[] = ["short_text"];

  constructor(
    readonly id: string,
    readonly label: string,
    private readonly http: IHttpClient,
    private readonly botToken: string,
    private readonly chatId: string,
  ) {}

  async publish(_c: Campaign, piece: CampaignPiece) {
    const api = `https://api.telegram.org/bot${this.botToken}`;
    const res = await this.http.send("POST", `${api}/sendMessage`, { chat_id: this.chatId, text: piece.text, link_preview_options: { is_disabled: false } });
    const data = JSON.parse(res.text || "{}") as { ok?: boolean; result?: { message_id: number }; description?: string };
    if (!data.ok) return { ok: false, reach: 0, error: data.description ?? `HTTP ${res.status}` };
    const count = JSON.parse((await this.http.get(`${api}/getChatMemberCount?chat_id=${encodeURIComponent(this.chatId)}`)).text || "{}") as { result?: number };
    return { ok: true, reach: count.result ?? 0, externalId: String(data.result?.message_id) };
  }
}

/** Sitio o newsletter propio de la organización: recibe cada pieza firmada y la publica. */
export class OwnSiteCampaignChannel implements ICampaignChannel {
  readonly accepts: CampaignPieceKind[] = ["short_text", "card", "newsletter"];

  constructor(
    readonly id: string,
    readonly label: string,
    private readonly http: IHttpClient,
    private readonly endpoint: string,
    private readonly secret: string,
  ) {}

  async publish(c: Campaign, piece: CampaignPiece, pieceIndex: number) {
    const body = JSON.stringify({ campaignId: c.id, sponsor: c.sponsor, claim: c.claim, pieceIndex, piece });
    const ts = Math.floor(Date.now() / 1000).toString();
    const res = await this.http.send("POST", this.endpoint, body, {
      "content-type": "application/json",
      "x-sinhumo-timestamp": ts,
      "x-sinhumo-signature": `sha256=${createHmac("sha256", this.secret).update(`${ts}.${body}`).digest("hex")}`,
    });
    const data = JSON.parse(res.text || "{}") as { reach?: number; id?: string };
    return res.status < 300 ? { ok: true, reach: data.reach ?? 0, externalId: data.id } : { ok: false, reach: 0, error: `HTTP ${res.status}` };
  }
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if ((line + " " + word).trim().length > maxChars) {
      lines.push(line.trim());
      line = word;
      if (lines.length === maxLines) break;
    } else line += ` ${word}`;
  }
  if (lines.length < maxLines && line.trim()) lines.push(line.trim());
  if (lines.length === maxLines && text.length > lines.join(" ").length) lines[maxLines - 1] = `${lines[maxLines - 1]!.slice(0, maxChars - 1)}…`;
  return lines;
}

/**
 * Tarjeta cuadrada (1080×1080) en SVG, lista para redes y WhatsApp.
 * Para PNG se agrega un conversor detrás de la misma interfaz.
 */
export class SvgCardGenerator implements IAssetGenerator {
  constructor(private readonly colors = { bg: "#0f172a", accent: "#22c55e", text: "#f8fafc", muted: "#94a3b8" }) {}

  async card(input: { title: string; body: string; footer: string }) {
    const c = this.colors;
    const title = wrap(input.title, 26, 3);
    const body = wrap(input.body, 44, 8);
    const t = title.map((l, i) => `<text x="80" y="${200 + i * 70}" font-size="56" font-weight="700" fill="${c.text}">${xml(l)}</text>`).join("");
    const b = body.map((l, i) => `<text x="80" y="${220 + title.length * 70 + 40 + i * 48}" font-size="34" fill="${c.text}">${xml(l)}</text>`).join("");
    // Accesible: role="img" + título y descripción (lectores de pantalla) + idioma.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080" font-family="Helvetica, Arial, sans-serif" role="img" aria-labelledby="t d" lang="es">
<title id="t">${xml(title.join(" "))}</title><desc id="d">${xml(`${body.join(" ")} ${input.footer}`)}</desc>
<rect width="1080" height="1080" fill="${c.bg}"/><rect x="80" y="90" width="120" height="10" fill="${c.accent}"/>
<text x="80" y="140" font-size="28" fill="${c.accent}" font-weight="700">SIN HUMO · DATO VERIFICADO</text>${t}${b}
<text x="80" y="1000" font-size="26" fill="${c.muted}">${xml(input.footer)}</text></svg>`;
    return { contentType: "image/svg+xml", data: svg };
  }
}

/**
 * Tiempo real en memoria (un servidor). Con varios servidores se reemplaza por un
 * adaptador sobre Redis pub/sub con la MISMA interfaz.
 */
export class InMemoryRealtimeHub implements IRealtimeTransport {
  private readonly rooms = new Map<string, Map<string, { userId: string; listener: (e: RoomEvent) => void }>>();

  publish(roomId: string, event: RoomEvent): void {
    for (const s of this.rooms.get(roomId)?.values() ?? []) {
      try {
        s.listener(event);
      } catch {
        /* un cliente caído no afecta a los demás */
      }
    }
  }

  subscribe(roomId: string, userId: string, listener: (e: RoomEvent) => void): () => void {
    const subs = this.rooms.get(roomId) ?? new Map();
    this.rooms.set(roomId, subs);
    const key = randomUUID();
    subs.set(key, { userId, listener });
    return () => subs.delete(key);
  }

  present(roomId: string): string[] {
    return [...new Set([...(this.rooms.get(roomId)?.values() ?? [])].map((s) => s.userId))];
  }
}
