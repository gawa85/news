import type { ChannelType, InboundMessage } from "../../domain/model";
import type { IInboundMediaFetcher, ISpeechToText } from "../../domain/ports";

/** Límite de los proveedores de transcripción (Whisper: 25 MB). */
const MAX_BYTES = 25 * 1024 * 1024;

export type VoiceNoteResult =
  | { ok: true; text: string; seconds?: number }
  | { ok: false; reason: "channel_unsupported" | "too_long" | "empty" | "failed"; maxSeconds: number };

/**
 * NOTAS DE VOZ: mucha gente reenvía audios en vez de texto (y muchos "audios de un amigo
 * que trabaja en…" son humo). Se bajan del canal, se transcriben y el texto sigue el
 * camino de cualquier mensaje.
 *
 * REGLAS:
 *  - Duración máxima configurable (`voice.max_seconds`): si el canal informa la duración,
 *    se rechaza ANTES de bajar el audio (no se gasta nada).
 *  - El audio no se guarda: sólo queda el texto, como cualquier mensaje.
 *  - Se cobra por los segundos transcriptos (costo del proveedor, al cliente del pedido).
 */
export class VoiceNoteService {
  private readonly fetchers = new Map<ChannelType, IInboundMediaFetcher>();

  constructor(
    private readonly stt: ISpeechToText,
    fetchers: IInboundMediaFetcher[],
    private readonly maxSeconds: () => Promise<number>,
    private readonly onCost?: (seconds: number) => Promise<void>,
  ) {
    fetchers.forEach((f) => this.fetchers.set(f.channel, f));
  }

  async transcribe(msg: InboundMessage, language: string): Promise<VoiceNoteResult> {
    const maxSeconds = await this.maxSeconds();
    const audio = msg.audio;
    const fetcher = this.fetchers.get(msg.channel);
    if (!audio || !fetcher) return { ok: false, reason: "channel_unsupported", maxSeconds };
    if (audio.seconds !== undefined && audio.seconds > maxSeconds) return { ok: false, reason: "too_long", maxSeconds };

    let result: { text: string; seconds?: number };
    try {
      const file = await fetcher.fetch(audio.ref, MAX_BYTES);
      result = await this.stt.transcribe({ data: file.data, mime: audio.mime ?? file.mime }, language);
    } catch {
      return { ok: false, reason: "failed", maxSeconds };
    }
    const seconds = result.seconds ?? audio.seconds;
    await this.onCost?.(seconds ?? 60);
    const text = result.text.replace(/\s+/g, " ").trim();
    return text ? { ok: true, text, seconds } : { ok: false, reason: "empty", maxSeconds };
  }
}
