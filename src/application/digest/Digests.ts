import { ConflictError } from "../../domain/errors";
import type { Digest, DigestKind, EffectivePreferences, ResponseContent, User } from "../../domain/model";
import type {
  IClock,
  ICountryRegistry,
  IDigestDeliveryRepository,
  IDigestSource,
  IFeatureFlags,
  ILogger,
  IParameterStore,
  IPreferencesReader,
  IPreferencesRepository,
  IUserRepository,
} from "../../domain/ports";
import { digestDue, digestWindowStart } from "../../domain/rules/digest";
import type { AccessControl } from "../access/AccessControl";
import type { ResponseComposer } from "../messaging/ResponseComposer";
import type { NotificationService } from "../messaging/NotificationService";

/** Plantilla de WhatsApp aprobada para el resumen (fuera de la ventana de 24 h). */
export const DIGEST_TEMPLATE = "resumen_sin_humo";

/**
 * A QUIÉN le puede tocar un resumen: quienes lo pidieron y los miembros de organizaciones
 * que lo tienen por defecto. Después cada uno se decide con sus preferencias efectivas.
 */
export class DigestAudience {
  constructor(
    private readonly prefs: IPreferencesRepository,
    private readonly users: IUserRepository,
  ) {}

  async candidates(): Promise<User[]> {
    const byId = new Map<string, User>();
    for (const org of await this.prefs.findOrgsWithDigest()) {
      for (const u of await this.users.findByOrganization(org.organizationId)) byId.set(u.id, u);
    }
    for (const p of await this.prefs.findUsersWithDigest()) {
      if (byId.has(p.userId)) continue;
      const u = await this.users.findById(p.userId);
      if (u) byId.set(u.id, u);
    }
    return [...byId.values()].filter((u) => u.status === "active");
  }
}

export type DigestOutcome = "off" | "not_due" | "already" | "empty" | "sent" | "deferred" | "failed";

/**
 * RESUMEN DIARIO O SEMANAL.
 *
 * REGLAS:
 *  - Sale a la hora `digest.hour` (hora local de la persona: su horario de silencio o su país);
 *    el semanal, el día `digest.weekday`. Si el servidor estuvo caído, sale apenas vuelve.
 *  - Uno solo por persona y período, aunque haya varios servidores (lo garantiza la base).
 *  - Cuenta desde el último resumen enviado (como mucho, dos períodos atrás).
 *  - Si no hay nada que contar, no se manda (`digest.send_empty`).
 *  - El diario es de los planes pagos (`daily_digest`); en el gratis se manda el semanal.
 *  - Se envía como cualquier aviso: respeta el horario de silencio, el orden de canales y la
 *    ventana de WhatsApp (afuera, con plantilla).
 */
export class DigestService {
  constructor(
    private readonly sources: IDigestSource[],
    private readonly deliveries: IDigestDeliveryRepository,
    private readonly audience: DigestAudience,
    private readonly preferences: IPreferencesReader,
    private readonly access: AccessControl,
    private readonly countries: ICountryRegistry,
    private readonly notifications: NotificationService,
    private readonly composer: ResponseComposer,
    private readonly params: IParameterStore,
    private readonly flags: IFeatureFlags,
    private readonly clock: IClock,
    private readonly logger: ILogger,
  ) {}

  /** Lo corre el planificador: manda los resúmenes que ya tocan. */
  async runDue(): Promise<Record<DigestOutcome, number>> {
    const counts = { off: 0, not_due: 0, already: 0, empty: 0, sent: 0, deferred: 0, failed: 0 };
    for (const user of await this.audience.candidates()) {
      try {
        counts[await this.sendIfDue(user)]++;
      } catch (e) {
        counts.failed++;
        this.logger.warn("Falló un resumen", { userId: user.id, error: String(e) });
      }
    }
    return counts;
  }

  async sendIfDue(user: User): Promise<DigestOutcome> {
    const prefs = await this.preferences.effective(user);
    if (prefs.digest === "off") return "off";
    const { plan } = await this.access.planOf(user);
    if (!(await this.flags.isEnabled("digest", { userId: user.id, organizationId: user.organizationId, planId: plan.id, country: user.country }))) return "off";
    const kind = this.kindFor(prefs.digest, plan.features);
    const now = this.clock.now();
    const offset = prefs.quietHours?.utcOffsetMinutes ?? this.countries.get(user.country).utcOffsetMinutes;
    const { due, periodKey } = digestDue(kind, now, offset, { hour: await this.params.number("digest.hour"), weekday: await this.params.number("digest.weekday") });
    if (!due) return "not_due";

    const from = digestWindowStart(kind, now, (await this.deliveries.findLastSent(user.id))?.to);
    const base = { id: `${user.id}:${periodKey}`, userId: user.id, kind, periodKey, from, to: now, items: 0, at: now };
    try {
      await this.deliveries.insert({ ...base, status: "sending" });
    } catch (e) {
      if (e instanceof ConflictError) return "already";
      throw e;
    }

    const digest = await this.build(user, prefs, kind, from, now);
    const items = digest.sections.reduce((n, s) => n + s.items.length, 0);
    if (items === 0 && !(await this.params.boolean("digest.send_empty"))) {
      await this.deliveries.save({ ...base, status: "empty" });
      return "empty";
    }
    const content = this.composer.digest(digest);
    const r = await this.notifications.notifyUser(user, content, plan.channels, {
      name: DIGEST_TEMPLATE,
      language: "es_AR",
      params: [kind === "daily" ? "diario" : "semanal", content.summary ?? "", String(items)],
    });
    const status = r.deferredUntil ? "deferred" : r.ok ? "sent" : "failed";
    await this.deliveries.save({ ...base, status, items, channel: r.channel, error: r.ok ? undefined : r.error });
    return status;
  }

  /** "/resumen": lo que diría el próximo resumen, ya mismo (no cuenta como enviado). */
  async preview(user: User): Promise<ResponseContent> {
    const prefs = await this.preferences.effective(user);
    const { plan } = await this.access.planOf(user);
    const kind = this.kindFor(prefs.digest === "off" ? "daily" : prefs.digest, plan.features);
    const now = this.clock.now();
    const from = digestWindowStart(kind, now, (await this.deliveries.findLastSent(user.id))?.to);
    return this.composer.digest(await this.build(user, prefs, kind, from, now));
  }

  async build(user: User, prefs: EffectivePreferences, kind: DigestKind, from: Date, to: Date): Promise<Digest> {
    const ctx = { user, prefs, from, to };
    // Una parte que falla no tira abajo el resumen.
    const sections = await Promise.all(
      this.sources.map((s) =>
        s.collect(ctx).catch((e) => {
          this.logger.warn("Falló una parte del resumen", { source: s.id, error: String(e) });
          return undefined;
        }),
      ),
    );
    return { userId: user.id, kind, period: { from, to }, sections: sections.filter((s) => s !== undefined) };
  }

  private kindFor(wanted: DigestKind, features: readonly string[]): DigestKind {
    return wanted === "daily" && !features.includes("daily_digest") ? "weekly" : wanted;
  }
}
