/**
 * IDIOMAS en el producto, SIN tocar lo existente: todo son decoradores de puertos que ya
 * había (detector de humo, extractor de afirmaciones, intérprete de comandos) y un
 * localizador de respuestas. Dependen de ITranslator / ILanguageDetector, no de un proveedor.
 */
import type { Article, Claim, Command, LanguageCode, ResponseContent, SmokeAnalysis } from "../../domain/model";
import type { IClaimExtractor, ICommandParser, ILanguageDetector, ISmokeDetector, ITranslator } from "../../domain/ports";
import { BASE_LANGUAGE, COMMAND_ALIASES, MIN_DETECTION_CONFIDENCE, VALUE_ALIASES } from "../../config/languages";

/** ¿Está en otro idioma (con seguridad suficiente)? Devuelve el idioma o undefined. */
async function foreign(detector: ILanguageDetector, text: string, base: LanguageCode): Promise<LanguageCode | undefined> {
  const d = await detector.detect(text);
  return d.language !== base && d.confidence >= MIN_DETECTION_CONFIDENCE ? d.language : undefined;
}

/**
 * Detector de humo para mensajes en otros idiomas: el diccionario de reglas (y las instrucciones
 * del modelo) están en castellano, así que primero se traduce. Si la traducción falla, se
 * analiza el original (peor análisis, pero respuesta).
 */
export class TranslatingSmokeDetector implements ISmokeDetector {
  get version() {
    return this.inner.version;
  }

  constructor(
    private readonly inner: ISmokeDetector,
    private readonly detector: ILanguageDetector,
    private readonly translator: ITranslator,
    private readonly base: LanguageCode = BASE_LANGUAGE,
  ) {}

  async analyze(text: string): Promise<SmokeAnalysis> {
    const lang = await foreign(this.detector, text, this.base);
    if (!lang) return this.inner.analyze(text);
    try {
      const [translated] = await this.translator.translate([text], this.base, lang);
      return await this.inner.analyze(translated!);
    } catch {
      return this.inner.analyze(text);
    }
  }
}

/**
 * Extractor de afirmaciones para notas en otros idiomas: se traducen título y cuerpo, así
 * las afirmaciones quedan en castellano y se pueden agrupar con las de las fuentes locales
 * (la comparación es por similitud de texto: sin traducir, nunca coincidirían).
 */
export class TranslatingClaimExtractor implements IClaimExtractor {
  constructor(
    private readonly inner: IClaimExtractor,
    private readonly detector: ILanguageDetector,
    private readonly translator: ITranslator,
    private readonly base: LanguageCode = BASE_LANGUAGE,
  ) {}

  async extract(article: Article): Promise<Claim[]> {
    const lang = await foreign(this.detector, `${article.title}\n${article.body}`, this.base);
    if (!lang) return this.inner.extract(article);
    try {
      const [title, body] = await this.translator.translate([article.title, article.body], this.base, lang);
      return await this.inner.extract({ ...article, title: title!, body: body! });
    } catch {
      return this.inner.extract(article);
    }
  }
}

/** Lo que no se traduce: links, comandos, menciones, mails y el "¿Te sirvió? SÍ/NO" (son palabras clave). */
const PROTECTED = /https?:\/\/[^\s)]+|(?<![\w/])\/[a-záéíóúñ-]+|@[\w.]+|\b[\w.+-]+@[\w-]+\.[\w.]+\b|\b(?:SÍ|NO|BAJA|ALTA|HUMO|LIMPIO)\b/g;

/**
 * RESPUESTAS en el idioma de la persona: traduce todos los textos de una respuesta en una
 * sola llamada, protegiendo links y comandos (si se traducen, dejan de andar). Si falla,
 * la respuesta sale en castellano: nunca se pierde.
 */
export class ResponseLocalizer {
  constructor(
    private readonly translator: ITranslator,
    private readonly base: LanguageCode = BASE_LANGUAGE,
  ) {}

  async localize(c: ResponseContent, to: LanguageCode): Promise<ResponseContent> {
    if (to === this.base) return c;
    const texts: string[] = [];
    const put = (s: string | undefined) => (s ? texts.push(s) - 1 : -1);
    const idx = {
      title: put(c.title),
      summary: put(c.summary),
      footer: put(c.footer),
      sections: c.sections.map((s) => ({ heading: put(s.heading), lines: s.lines.map(put) })),
      links: c.links.map((l) => put(l.label)),
    };
    if (texts.length === 0) return c;

    const saved: string[][] = [];
    const masked = texts.map((t, i) => {
      saved[i] = [];
      return t.replace(PROTECTED, (m) => `⟦${saved[i]!.push(m) - 1}⟧`);
    });
    let out: string[];
    try {
      out = await this.translator.translate(masked, to, this.base);
    } catch {
      return c;
    }
    const get = (i: number, fallback?: string) => (i < 0 ? fallback : (out[i] ?? texts[i]!).replace(/⟦(\d+)⟧/g, (m, n: string) => saved[i]![Number(n)] ?? m));
    return {
      ...c,
      title: get(idx.title, c.title)!,
      summary: get(idx.summary, c.summary),
      footer: get(idx.footer, c.footer),
      sections: c.sections.map((s, k) => ({ heading: get(idx.sections[k]!.heading, s.heading), lines: s.lines.map((l, j) => get(idx.sections[k]!.lines[j]!, l)!) })),
      links: c.links.map((l, k) => ({ ...l, label: get(idx.links[k]!, l.label)! })),
    };
  }
}

/** Comandos cuyos valores también se traducen ("/audio sim", "/resumo diário", "/save <link> watch"). */
const VALUE_COMMANDS = new Set(["formato", "audio", "resumen", "guardar", "silencio"]);
const ALIASES: Record<string, string> = Object.assign({}, ...Object.values(COMMAND_ALIASES));

/**
 * Intérprete de comandos en varios idiomas (decorador): pasa "/ajuda", "/help", "/resumo
 * semanal"… a su forma en castellano y deja el resto al intérprete de siempre.
 */
export class MultilingualCommandParser implements ICommandParser {
  constructor(private readonly inner: ICommandParser) {}

  parse(text: string): Command {
    const t = text.trim();
    const m = /^\/(\S+)(.*)$/s.exec(t);
    if (!m) return this.inner.parse(t);
    const name = ALIASES[m[1]!.toLowerCase()] ?? m[1]!;
    const rest = VALUE_COMMANDS.has(name)
      ? m[2]!.replace(/[^\s]+/g, (w) => (/^https?:\/\//.test(w) ? w : (VALUE_ALIASES[w.toLowerCase()] ?? w)))
      : m[2]!;
    return this.inner.parse(`/${name}${rest}`);
  }
}
