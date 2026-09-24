/**
 * Puertos de MENSAJERÍA. Sumar un canal (Instagram, Slack, SMS...) =
 * implementar estas tres interfaces y registrarlas. Nada más cambia.
 */
import type { ChannelType, Command, DeliveryResult, InboundMessage, OutboundMessage, ResponseContent } from "../model";

/** Convierte el webhook crudo de un proveedor en un InboundMessage normalizado. */
export interface IInboundParser {
  readonly channel: ChannelType;
  /** `null` si el payload no es un mensaje de texto (confirmaciones de lectura, estados, etc.). */
  parse(payload: unknown): InboundMessage | null;
}

/** Dibuja una respuesta neutra en el formato del canal (largo máximo, negritas, HTML...). */
export interface IChannelRenderer {
  readonly channel: ChannelType;
  render(content: ResponseContent, to: string): OutboundMessage;
}

/** Envía por el proveedor del canal (API de WhatsApp Cloud, Bot API de Telegram, SMTP...). */
export interface IMessageSender {
  readonly channel: ChannelType;
  send(message: OutboundMessage): Promise<DeliveryResult>;
}

/** Interpreta el texto del usuario ("/comparar tarifas de gas") como un comando. */
export interface ICommandParser {
  parse(text: string): Command;
}
