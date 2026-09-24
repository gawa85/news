/**
 * Puertos de MAIL.
 *  - IEmailTransport: ENVIAR (SMTP con nodemailer, Amazon SES, Resend, etc.).
 *  - IInboundMailServer: RECIBIR por SMTP (el usuario reenvía mails a analizar@…).
 *  - Leer un buzón existente (IMAP, Gmail, Microsoft 365) es un IContentSource de tipo "email".
 */
import type { DeliveryResult } from "../model";

export interface EmailEnvelope {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Message-ID del mail al que se responde: mantiene el hilo en el cliente de correo. */
  inReplyTo?: string;
  references?: string[];
  headers?: Record<string, string>;
  attachments?: { filename: string; contentType: string; content: Buffer }[];
}

export interface IEmailTransport {
  send(mail: EmailEnvelope): Promise<DeliveryResult>;
}

export interface InboundMailEnvelope {
  mailFrom?: string;
  rcptTo: string[];
  remoteAddress?: string;
}

export interface IInboundMailServer {
  start(handler: (raw: Buffer, envelope: InboundMailEnvelope) => Promise<void>): Promise<{ port: number }>;
  stop(): Promise<void>;
}
