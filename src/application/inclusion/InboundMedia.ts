import type { ChannelType } from "../../domain/model";
import type { IInboundMediaFetcher } from "../../domain/ports";

/** Baja un archivo recibido por un canal (una sola vez, para todos los que lo usan: lectura de texto, revisión). */
export class InboundMediaDownloader {
  private readonly fetchers = new Map<ChannelType, IInboundMediaFetcher>();

  constructor(fetchers: IInboundMediaFetcher[]) {
    fetchers.forEach((f) => this.fetchers.set(f.channel, f));
  }

  supports(channel: ChannelType): boolean {
    return this.fetchers.has(channel);
  }

  /** undefined si el canal no permite bajar archivos. Tira si falla o si supera `maxBytes`. */
  async download(channel: ChannelType, ref: string, maxBytes: number): Promise<{ data: Buffer; mime: string } | undefined> {
    return this.fetchers.get(channel)?.fetch(ref, maxBytes);
  }
}
