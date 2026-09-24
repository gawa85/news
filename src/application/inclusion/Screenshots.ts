import type { ChannelType, InboundMessage } from "../../domain/model";
import type { IInboundMediaFetcher, IOcr } from "../../domain/ports";
import { cleanScreenshotText } from "../../domain/rules/screenshotText";

/** Tope de las APIs de visión (Claude: 5 MB por imagen; Vision: 20 MB). */
const MAX_BYTES = 5 * 1024 * 1024;
/** Menos que esto no alcanza para analizar nada. */
const MIN_CHARS = 15;

export type ScreenshotResult = { ok: true; text: string } | { ok: false; reason: "channel_unsupported" | "no_text" | "failed" };

export interface ScreenshotCosts {
  perImage(provider: string): Promise<void>;
  llm(model: string, inputTokens: number, outputTokens: number): Promise<void>;
}

/**
 * CAPTURAS DE PANTALLA: gran parte del humo circula como captura (de un tuit, de un chat,
 * de un "zócalo" de TV) justamente porque no tiene link ni se puede buscar.
 * Se lee el texto, se limpia la interfaz y sigue el camino de cualquier mensaje.
 *
 * REGLAS:
 *  - La imagen no se guarda: sólo el texto leído.
 *  - Se cobra lo que cobra el lector: por imagen (OCR clásico) o por tokens (IA con visión).
 *  - Si no hay texto suficiente, se avisa (analizar fotos sin texto es otra función).
 */
export class ScreenshotService {
  private readonly fetchers = new Map<ChannelType, IInboundMediaFetcher>();

  constructor(
    private readonly ocr: IOcr,
    fetchers: IInboundMediaFetcher[],
    private readonly costs?: ScreenshotCosts,
  ) {
    fetchers.forEach((f) => this.fetchers.set(f.channel, f));
  }

  async read(msg: InboundMessage, language: string): Promise<ScreenshotResult> {
    const image = msg.image;
    const fetcher = this.fetchers.get(msg.channel);
    if (!image || !fetcher) return { ok: false, reason: "channel_unsupported" };

    let result: Awaited<ReturnType<IOcr["read"]>>;
    try {
      const file = await fetcher.fetch(image.ref, MAX_BYTES);
      result = await this.ocr.read({ data: file.data, mime: image.mime ?? file.mime }, language);
    } catch {
      return { ok: false, reason: "failed" };
    }
    if (result.usage) await this.costs?.llm(result.usage.model, result.usage.inputTokens, result.usage.outputTokens);
    else await this.costs?.perImage(this.ocr.id);
    const text = cleanScreenshotText(result.text);
    return text.replace(/\s/g, "").length >= MIN_CHARS ? { ok: true, text } : { ok: false, reason: "no_text" };
  }
}
