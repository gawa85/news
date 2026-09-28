/**
 * IDIOMAS: detector y traductores intercambiables (LSP), más decoradores de caché y costo (OCP).
 */
import { createHash } from "node:crypto";
import type { DetectedLanguage, LanguageCode } from "../../domain/model";
import type { ICache, IHttpClient, ILanguageDetector, ITranslator } from "../../domain/ports";
import { detectLanguage } from "../../domain/rules/language";
import type { ILLMClient } from "../llm/ILLMClient";

/** Por palabras frecuentes: gratis, sin red. */
export class StopwordLanguageDetector implements ILanguageDetector {
  async detect(text: string): Promise<DetectedLanguage> {
    return detectLanguage(text);
  }
}

// ---------------- Traductores ----------------

/** DeepL (la clave gratuita termina en ":fx" y usa otro servidor). */
export class DeepLTranslator implements ITranslator {
  readonly id = "deepl";
  private static readonly TARGET: Record<string, string> = { pt: "PT-BR", en: "EN-US" };

  constructor(
    private readonly http: IHttpClient,
    private readonly apiKey: string,
  ) {}

  async translate(texts: string[], to: LanguageCode, from?: LanguageCode): Promise<string[]> {
    const host = this.apiKey.endsWith(":fx") ? "api-free.deepl.com" : "api.deepl.com";
    const res = await this.http.send("POST", `https://${host}/v2/translate`, {
      text: texts,
      target_lang: DeepLTranslator.TARGET[to] ?? to.toUpperCase(),
      ...(from ? { source_lang: from.toUpperCase() } : {}),
      preserve_formatting: true,
    }, { authorization: `DeepL-Auth-Key ${this.apiKey}` });
    if (res.status !== 200) throw new Error(`DeepL respondió HTTP ${res.status}.`);
    return (JSON.parse(res.text) as { translations: { text: string }[] }).translations.map((t) => t.text);
  }
}

/** Google Cloud Translation (v2, con clave de API). */
export class GoogleTranslator implements ITranslator {
  readonly id = "google-translate";

  constructor(
    private readonly http: IHttpClient,
    private readonly apiKey: string,
  ) {}

  async translate(texts: string[], to: LanguageCode, from?: LanguageCode): Promise<string[]> {
    const res = await this.http.send("POST", `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(this.apiKey)}`, {
      q: texts,
      target: to,
      ...(from ? { source: from } : {}),
      format: "text",
    });
    if (res.status !== 200) throw new Error(`Google Translate respondió HTTP ${res.status}.`);
    return (JSON.parse(res.text) as { data: { translations: { translatedText: string }[] } }).data.translations.map((t) => t.translatedText);
  }
}

const LLM_SYSTEM = (to: string) => `Traducí cada texto de la lista al idioma "${to}" (ISO 639-1), con registro neutro y claro.
Devolvé {"texts": [string]} con la MISMA cantidad y el MISMO orden.
No traduzcas nombres propios, siglas, cifras ni direcciones web. Dejá intactos los marcadores ⟦0⟧, ⟦1⟧…
Si un texto ya está en ese idioma, devolvelo igual.`;

/** Con el modelo de IA configurado (el cliente llega envuelto con spotlighting y medición de costo). */
export class LLMTranslator implements ITranslator {
  readonly id = "ia";

  constructor(private readonly llm: ILLMClient) {}

  async translate(texts: string[], to: LanguageCode): Promise<string[]> {
    const { data } = await this.llm.completeJSON<{ texts?: string[] }>({ system: LLM_SYSTEM(to), user: JSON.stringify(texts), maxTokens: 4000 });
    if (!Array.isArray(data.texts) || data.texts.length !== texts.length) throw new Error("La traducción no devolvió todos los textos.");
    return data.texts.map(String);
  }
}

/** Para tests y demo: marca el idioma delante. */
export class FakeTranslator implements ITranslator {
  readonly id = "fake-translator";
  readonly calls: { texts: string[]; to: string; from?: string }[] = [];

  async translate(texts: string[], to: LanguageCode, from?: LanguageCode): Promise<string[]> {
    this.calls.push({ texts, to, from });
    return texts.map((t) => (t.trim() ? `[${to}] ${t}` : t));
  }
}

// ---------------- Decoradores ----------------

/** No traduce dos veces lo mismo (los textos fijos de las respuestas se repiten mucho). */
export class CachedTranslator implements ITranslator {
  get id() {
    return this.inner.id;
  }

  constructor(
    private readonly inner: ITranslator,
    private readonly cache: ICache,
    private readonly ttlSeconds = 30 * 86_400,
  ) {}

  async translate(texts: string[], to: LanguageCode, from?: LanguageCode): Promise<string[]> {
    const key = (t: string) => `tr:${this.inner.id}:${from ?? "auto"}:${to}:${createHash("sha256").update(t).digest("hex")}`;
    const out = await Promise.all(texts.map((t) => this.cache.get<string>(key(t))));
    const missing = texts.map((t, i) => (out[i] === undefined ? i : -1)).filter((i) => i >= 0);
    if (missing.length) {
      const done = await this.inner.translate(missing.map((i) => texts[i]!), to, from);
      await Promise.all(missing.map((i, k) => ((out[i] = done[k]!), this.cache.set(key(texts[i]!), done[k]!, this.ttlSeconds))));
    }
    return out as string[];
  }
}

/** Registra el costo (por caracteres) de lo que efectivamente se tradujo. */
export class MeteredTranslator implements ITranslator {
  get id() {
    return this.inner.id;
  }

  constructor(
    private readonly inner: ITranslator,
    private readonly onCost: (provider: string, characters: number) => Promise<void>,
  ) {}

  async translate(texts: string[], to: LanguageCode, from?: LanguageCode): Promise<string[]> {
    const out = await this.inner.translate(texts, to, from);
    await this.onCost(this.inner.id, texts.reduce((n, t) => n + t.length, 0));
    return out;
  }
}
