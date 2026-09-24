/**
 * Adaptadores de inclusión y operación: lectura fácil, voz, archivos firmados, DNS
 * y mesa de ayuda externa.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { promises as dns } from "node:dns";
import type { ResponseContent, Ticket } from "../../domain/model";
import type { IClock, IDnsTxtResolver, IHttpClient, IMediaRepository, IMediaStore, IPlainLanguageRewriter, ISupportDesk, ITextToSpeech } from "../../domain/ports";
import type { ILLMClient } from "../llm/ILLMClient";

// ---------------- Lectura fácil ----------------

/** Jerga del producto → palabras de todos los días. */
const GLOSSARY: [RegExp, string][] = [
  [/índice de humo/gi, "cuánto humo tiene"],
  [/afirmaci[oó]n(es)? sin fuente/gi, "dice algo sin decir quién lo dijo"],
  [/adjetivos? inflados?/gi, "palabras exageradas"],
  [/alarmismo/gi, "quiere asustar"],
  [/promesas? vagas?/gi, "promete sin decir cómo ni cuándo"],
  [/lenguaje de marketing/gi, "quiere vender algo"],
  [/pedido de reenv[ií]o/gi, "pide que lo reenvíes"],
  [/relleno/gi, "palabras que no dicen nada"],
  [/credibilidad/gi, "confianza"],
  [/fuentes? primarias?/gi, "el documento original"],
  [/pauta oficial/gi, "publicidad que paga el gobierno"],
  [/verificaci[oó]n/gi, "control"],
  [/\bdifieren\b/gi, "no están de acuerdo"],
  [/\bconcuerdan\b|\bcoinciden\b/gi, "están de acuerdo"],
];

function simplify(s: string): string {
  let out = s.replace(/\([^)]*\)/g, "").replace(/\s{2,}/g, " ").trim();
  for (const [re, rep] of GLOSSARY) out = out.replace(re, rep);
  // Frases largas: se cortan en ";" y en las comas si pasan de 20 palabras.
  return out
    .split(/;\s*/)
    .flatMap((p) => (p.split(/\s+/).length > 20 ? p.split(/,\s+/) : [p]))
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).replace(/[.:]?$/, "."))
    .join(" ");
}

/** Reglas simples (sin IA): glosario, sin paréntesis, frases cortas, máximo 5 ideas. */
export class RuleBasedPlainLanguage implements IPlainLanguageRewriter {
  async rewrite(c: ResponseContent): Promise<ResponseContent> {
    const lines = c.sections.flatMap((s) => s.lines).slice(0, 5).map(simplify);
    return {
      ...c,
      title: simplify(c.title).replace(/\.$/, ""),
      summary: c.summary ? simplify(c.summary) : undefined,
      sections: lines.length ? [{ heading: "Lo importante", lines }] : [],
      links: c.links.slice(0, 1),
    };
  }
}

const EASY_READ_SYSTEM = `Reescribí el contenido en LECTURA FÁCIL, en español rioplatense:
frases de menos de 15 palabras, una idea por frase, palabras comunes, sin siglas sin explicar,
sin paréntesis, voz activa. No agregues información que no esté. No quites advertencias importantes.
Devolvé {"title": string, "summary": string, "lines": [string] (máximo 5)}.`;

/** Con IA (mejor calidad). Si falla, usa las reglas. */
export class LLMPlainLanguageRewriter implements IPlainLanguageRewriter {
  private readonly fallback = new RuleBasedPlainLanguage();
  constructor(private readonly llm: ILLMClient) {}

  async rewrite(c: ResponseContent): Promise<ResponseContent> {
    try {
      const { data } = await this.llm.completeJSON<{ title: string; summary: string; lines: string[] }>({
        system: EASY_READ_SYSTEM,
        user: JSON.stringify({ title: c.title, summary: c.summary, lines: c.sections.flatMap((s) => s.lines) }),
        maxTokens: 600,
      });
      return { ...c, title: data.title, summary: data.summary, sections: [{ heading: "Lo importante", lines: (data.lines ?? []).slice(0, 5) }], links: c.links.slice(0, 1) };
    } catch {
      return this.fallback.rewrite(c);
    }
  }
}

// ---------------- Voz ----------------

/** Google Cloud Text-to-Speech (REST). Otros proveedores = otra clase igual. */
export class GoogleCloudTextToSpeech implements ITextToSpeech {
  readonly id = "google-tts";
  constructor(
    private readonly http: IHttpClient,
    private readonly cfg: { apiKey: string; voices?: Record<string, string> },
  ) {}

  async synthesize(text: string, language: string): Promise<{ data: Buffer; mime: string; seconds?: number }> {
    const languageCode = language === "es" ? "es-US" : language;
    const res = await this.http.send("POST", `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(this.cfg.apiKey)}`, {
      input: { text },
      voice: { languageCode, ...(this.cfg.voices?.[language] ? { name: this.cfg.voices[language] } : {}) },
      audioConfig: { audioEncoding: "MP3", speakingRate: 0.95 },
    });
    if (res.status !== 200) throw new Error(`Texto a voz: HTTP ${res.status}`);
    const { audioContent } = JSON.parse(res.text) as { audioContent: string };
    return { data: Buffer.from(audioContent, "base64"), mime: "audio/mpeg", seconds: Math.round(text.split(/\s+/).length / 2.5) };
  }
}

/** Para tests y demo: "audio" falso con el texto adentro. */
export class FakeTextToSpeech implements ITextToSpeech {
  readonly id = "fake-tts";
  readonly calls: string[] = [];
  async synthesize(text: string): Promise<{ data: Buffer; mime: string; seconds?: number }> {
    this.calls.push(text);
    return { data: Buffer.from(`AUDIO:${text}`), mime: "audio/mpeg", seconds: 3 };
  }
}

/**
 * Archivos guardados en la base con link FIRMADO y con vencimiento:
 * /media/<id>?exp=<epoch>&sig=<hmac>. Sin la firma no se puede descargar.
 */
export class SignedMediaStore implements IMediaStore {
  constructor(
    private readonly repo: IMediaRepository,
    private readonly secret: string,
    private readonly publicBaseUrl: string,
    private readonly clock: IClock,
  ) {}

  private sign(id: string, exp: number): string {
    return createHmac("sha256", this.secret).update(`${id}.${exp}`).digest("base64url");
  }

  async put(data: Buffer, mime: string, ttlSeconds: number): Promise<{ id: string; url: string }> {
    if (data.length > 5_000_000) throw new Error("Archivo demasiado grande.");
    const id = randomBytes(12).toString("base64url");
    const exp = Math.floor(this.clock.now().getTime() / 1000) + ttlSeconds;
    await this.repo.put({ id, mime, dataBase64: data.toString("base64"), expiresAt: new Date(exp * 1000) });
    return { id, url: `${this.publicBaseUrl}/media/${id}?exp=${exp}&sig=${this.sign(id, exp)}` };
  }

  async get(id: string, signature: string, expires: number): Promise<{ data: Buffer; mime: string } | undefined> {
    const expected = Buffer.from(this.sign(id, expires));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined;
    if (expires * 1000 < this.clock.now().getTime()) return undefined;
    const m = await this.repo.get(id);
    if (!m || m.expiresAt < this.clock.now()) return undefined;
    return { data: Buffer.from(m.dataBase64, "base64"), mime: m.mime };
  }
}

// ---------------- DNS ----------------

export class NodeDnsTxtResolver implements IDnsTxtResolver {
  async resolveTxt(name: string): Promise<string[]> {
    return (await dns.resolveTxt(name)).map((chunks) => chunks.join(""));
  }
}

/** Para tests: registros cargados a mano. */
export class StaticDnsTxtResolver implements IDnsTxtResolver {
  constructor(readonly records: Record<string, string[]> = {}) {}
  async resolveTxt(name: string): Promise<string[]> {
    const r = this.records[name];
    if (!r) throw new Error("ENOTFOUND");
    return r;
  }
}

// ---------------- Mesa de ayuda externa ----------------

/** Zendesk (API v2): crea el ticket la primera vez y agrega comentarios después. */
export class ZendeskSupportDesk implements ISupportDesk {
  readonly id = "zendesk";
  constructor(
    private readonly http: IHttpClient,
    private readonly cfg: { subdomain: string; email: string; apiToken: string },
  ) {}

  async push(t: Ticket): Promise<{ externalId?: string }> {
    const auth = { authorization: `Basic ${Buffer.from(`${this.cfg.email}/token:${this.cfg.apiToken}`).toString("base64")}` };
    const base = `https://${this.cfg.subdomain}.zendesk.com/api/v2`;
    const last = t.messages.at(-1)!;
    const priority = { low: "low", normal: "normal", high: "high", urgent: "urgent" }[t.priority];
    if (!t.externalId) {
      const res = await this.http.send("POST", `${base}/tickets.json`, {
        ticket: { subject: `[${t.id}] ${t.subject}`, comment: { body: last.text }, priority, tags: ["sin-humo", t.category], external_id: t.id },
      }, auth);
      if (res.status >= 300) throw new Error(`Zendesk HTTP ${res.status}`);
      return { externalId: String((JSON.parse(res.text) as { ticket: { id: number } }).ticket.id) };
    }
    const res = await this.http.send("PUT", `${base}/tickets/${t.externalId}.json`, { ticket: { priority, comment: { body: last.text, public: !last.internal } } }, auth);
    if (res.status >= 300) throw new Error(`Zendesk HTTP ${res.status}`);
    return { externalId: t.externalId };
  }
}
