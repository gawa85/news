import type { ResponseContent } from "../../domain/model";
import type { IMediaStore, ITextToSpeech } from "../../domain/ports";

/**
 * RESPUESTAS EN AUDIO: para quien lee con dificultad o prefiere escuchar.
 * Arma un guion corto (título, resumen, lo principal), lo convierte en voz y lo guarda
 * con link firmado que vence (no queda un audio público para siempre).
 */
export class AudioReplyService {
  constructor(
    private readonly tts: ITextToSpeech,
    private readonly media: IMediaStore,
    private readonly maxChars = 1500,
    private readonly ttlSeconds = 7 * 24 * 3600,
    private readonly onCost?: (chars: number) => Promise<void>,
  ) {}

  script(c: ResponseContent): string {
    const lines = c.sections.flatMap((s) => s.lines).slice(0, 5);
    const text = [c.title, c.summary, ...lines]
      .filter(Boolean)
      .join(". ")
      .replace(/[*_•#]/g, "")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/\s+/g, " ")
      .replace(/\.\s*\./g, ".");
    return text.length > this.maxChars ? `${text.slice(0, this.maxChars - 1)}…` : text;
  }

  async attach(c: ResponseContent, language: string): Promise<ResponseContent> {
    const text = this.script(c);
    if (!text) return c;
    const audio = await this.tts.synthesize(text, language);
    await this.onCost?.(text.length);
    const { url } = await this.media.put(audio.data, audio.mime, this.ttlSeconds);
    return { ...c, audio: { url, mime: audio.mime, seconds: audio.seconds } };
  }
}
