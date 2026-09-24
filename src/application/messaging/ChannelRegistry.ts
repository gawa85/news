import { NotFoundError } from "../../domain/errors";
import type { ChannelType } from "../../domain/model";
import type { IChannelRenderer, IInboundParser, IMessageSender } from "../../domain/ports";

/**
 * Registro de canales. Sumar Instagram, Slack o SMS = registrar su parser,
 * renderer y sender. Ningún caso de uso cambia (OCP).
 */
export class ChannelRegistry {
  private readonly parsers = new Map<ChannelType, IInboundParser>();
  private readonly renderers = new Map<ChannelType, IChannelRenderer>();
  private readonly senders = new Map<ChannelType, IMessageSender>();

  constructor(parts: { parsers?: IInboundParser[]; renderers: IChannelRenderer[]; senders: IMessageSender[] }) {
    parts.parsers?.forEach((p) => this.parsers.set(p.channel, p));
    parts.renderers.forEach((r) => this.renderers.set(r.channel, r));
    parts.senders.forEach((s) => this.senders.set(s.channel, s));
  }

  parser(channel: ChannelType): IInboundParser {
    return this.get(this.parsers, channel, "parser");
  }

  renderer(channel: ChannelType): IChannelRenderer {
    return this.get(this.renderers, channel, "renderer");
  }

  sender(channel: ChannelType): IMessageSender {
    return this.get(this.senders, channel, "sender");
  }

  canSend(channel: ChannelType): boolean {
    return this.renderers.has(channel) && this.senders.has(channel);
  }

  private get<T>(map: Map<ChannelType, T>, channel: ChannelType, what: string): T {
    const x = map.get(channel);
    if (!x) throw new NotFoundError(`No hay ${what} registrado para el canal ${channel}.`);
    return x;
  }
}
