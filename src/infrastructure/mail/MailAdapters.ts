/**
 * Adaptadores de MAIL:
 *  - NodemailerSmtpTransport: enviar por SMTP (cualquier proveedor: propio, Gmail, SES por SMTP...).
 *  - SmtpInboundServer: recibir por SMTP (registro MX de un dominio → este servidor).
 *  - ImapMailboxSource: leer un buzón existente por IMAP (sólo lectura).
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ValidationError } from "../../domain/errors";
import { isPublicAddress } from "../../domain/rules/network";
import { ImapFlow } from "imapflow";
import nodemailer, { type Transporter } from "nodemailer";
import { SMTPServer, type SMTPServerOptions } from "smtp-server";
import type { ContentItem, DeliveryResult, SourceConnection } from "../../domain/model";
import type {
  EmailEnvelope,
  IContentSource,
  IDocumentTextExtractor,
  IEmailTransport,
  IInboundMailServer,
  IMimeParser,
  InboundMailEnvelope,
  PullResult,
} from "../../domain/ports";
import { htmlToText } from "./MailparserMimeParser";

// ---------------- Envío por SMTP ----------------

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
}

export class NodemailerSmtpTransport implements IEmailTransport {
  private readonly transporter: Transporter;

  constructor(cfg: SmtpConfig) {
    this.transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
      tls: { rejectUnauthorized: cfg.host !== "127.0.0.1" && cfg.host !== "localhost" },
    });
  }

  async send(mail: EmailEnvelope): Promise<DeliveryResult> {
    try {
      const info = await this.transporter.sendMail({
        from: mail.from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        inReplyTo: mail.inReplyTo,
        references: mail.references,
        headers: mail.headers,
        attachments: mail.attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
      });
      return { ok: true, providerMessageId: info.messageId };
    } catch (err) {
      const e = err as { responseCode?: number; message?: string };
      // Traducción de códigos SMTP al lenguaje común del freno automático:
      // 421/450/451/452 = "bajá el ritmo" (≈429). 550/554 con spam/bloqueo = rechazo (≈403).
      const code = e.responseCode;
      const httpStatus = code && [421, 450, 451, 452].includes(code) ? 429 : code && [550, 554].includes(code) && /spam|block|reject|policy/i.test(e.message ?? "") ? 403 : undefined;
      return { ok: false, error: e.message ?? String(err), httpStatus };
    }
  }
}

/** Para demo y tests: guarda los mails "enviados". */
export class RecordingEmailTransport implements IEmailTransport {
  readonly sent: EmailEnvelope[] = [];
  async send(mail: EmailEnvelope): Promise<DeliveryResult> {
    this.sent.push(mail);
    return { ok: true, providerMessageId: `<${this.sent.length}@sinhumo.test>` };
  }
}

/**
 * Para DESARROLLO sin SMTP: cada mail se escribe en el log (así el enlace para entrar a la
 * web local se ve con `docker compose logs api`). Nunca en producción: los mails tienen enlaces
 * de acceso y los logs no son un lugar seguro para eso.
 */
export class ConsoleEmailTransport implements IEmailTransport {
  readonly sent: EmailEnvelope[] = [];
  readonly localOnly = true;

  constructor(private readonly write: (line: string) => void = (l) => console.log(l)) {}

  async send(mail: EmailEnvelope): Promise<DeliveryResult> {
    this.sent.push(mail);
    this.write(`\n----- MAIL (desarrollo, no se envió) -----\nPara: ${mail.to}\nAsunto: ${mail.subject}\n\n${mail.text ?? ""}\n------------------------------------------\n`);
    return { ok: true, providerMessageId: `<consola-${this.sent.length}@sinhumo.dev>` };
  }
}

// ---------------- Recepción por SMTP ----------------

export interface InboundSmtpConfig {
  host: string;
  port: number;
  /** Dominios propios aceptados (analizar@sinhumo.example). Evita ser un relay abierto. */
  acceptedDomains: string[];
  maxMessageBytes: number;
  tls?: { key: Buffer; cert: Buffer };
}

/**
 * Servidor SMTP de RECEPCIÓN (librería smtp-server).
 * REGLAS: sólo acepta destinatarios de los dominios propios (no reenvía a terceros),
 * limita el tamaño y no pide autenticación (es un MX: los mails llegan de cualquier servidor).
 * En producción conviene ponerlo detrás de un MTA (Postfix) o un servicio de recepción
 * que agregue SPF/DKIM/DMARC en Authentication-Results.
 */
export class SmtpInboundServer implements IInboundMailServer {
  private server?: SMTPServer;

  constructor(private readonly cfg: InboundSmtpConfig) {}

  start(handler: (raw: Buffer, env: InboundMailEnvelope) => Promise<void>): Promise<{ port: number }> {
    const domains = this.cfg.acceptedDomains.map((d) => d.toLowerCase());
    const options: SMTPServerOptions = {
      authOptional: true,
      disabledCommands: ["AUTH"],
      size: this.cfg.maxMessageBytes,
      banner: "Sin Humo - recepción de mails para analizar",
      ...(this.cfg.tls ? { key: this.cfg.tls.key, cert: this.cfg.tls.cert } : { hideSTARTTLS: true }),
      onRcptTo(address, _session, cb) {
        const domain = address.address.split("@")[1]?.toLowerCase();
        if (!domain || !domains.includes(domain)) return cb(new Error("550 No se aceptan mails para ese dominio"));
        cb();
      },
      onData(stream, session, cb) {
        const chunks: Buffer[] = [];
        stream.on("data", (c: Buffer) => chunks.push(c));
        stream.on("end", () => {
          if ((stream as unknown as { sizeExceeded?: boolean }).sizeExceeded) {
            const err = new Error("552 Mensaje demasiado grande") as Error & { responseCode: number };
            err.responseCode = 552;
            return cb(err);
          }
          const env: InboundMailEnvelope = {
            mailFrom: session.envelope.mailFrom ? session.envelope.mailFrom.address : undefined,
            rcptTo: session.envelope.rcptTo.map((r) => r.address),
            remoteAddress: session.remoteAddress,
          };
          // Se acepta el mail enseguida y se procesa después: no se hace esperar al remitente.
          cb();
          handler(Buffer.concat(chunks), env).catch(() => undefined);
        });
      },
    };
    this.server = new SMTPServer(options);
    return new Promise((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.cfg.port, this.cfg.host, () => {
        const addr = (this.server as unknown as { server: { address(): { port: number } } }).server.address();
        resolve({ port: addr.port });
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}

// ---------------- Lectura de un buzón por IMAP ----------------

/**
 * Lee mails nuevos de un buzón (Gmail, Outlook, propio) por IMAP, en modo SÓLO LECTURA:
 * no marca como leído ni borra nada. El cursor es el último UID procesado.
 * Config: host, port, user, folder (INBOX por defecto). La contraseña o token viene de la bóveda.
 */
/**
 * Buzón IMAP de la persona. El host y el puerto los escribe ella: sin control, el servidor se
 * podría usar para tocar la red interna (la base, otros servicios). Por eso: sólo puertos IMAP,
 * sólo hosts que resuelven a IPs públicas, y se conecta A ESA IP (el nombre queda para validar
 * el certificado): un DNS tramposo no puede cambiarla entre el control y la conexión.
 */
export class ImapMailboxSource implements IContentSource {
  readonly type = "email" as const;

  constructor(
    private readonly parser: IMimeParser,
    private readonly maxPerSync = 50,
    private readonly opts: { allowPrivate?: boolean; resolve?: (host: string) => Promise<string[]> } = {},
  ) {}

  async test(conn: SourceConnection, secret?: string): Promise<void> {
    const client = await this.client(conn, secret);
    await client.connect();
    try {
      await client.mailboxOpen(conn.config.folder ?? "INBOX", { readOnly: true });
    } finally {
      await client.logout();
    }
  }

  async pull(conn: SourceConnection, secret?: string): Promise<PullResult> {
    const client = await this.client(conn, secret);
    await client.connect();
    const lock = await client.getMailboxLock(conn.config.folder ?? "INBOX", { readOnly: true });
    const items: ContentItem[] = [];
    const since = Number(conn.cursor ?? 0);
    let maxUid = since;
    try {
      for await (const msg of client.fetch(`${since + 1}:*`, { uid: true, source: true }, { uid: true })) {
        if (msg.uid <= since || !msg.source) continue; // IMAP devuelve el último aunque no haya nuevos
        items.push(await this.parser.parse(msg.source));
        maxUid = Math.max(maxUid, msg.uid);
        if (items.length >= this.maxPerSync) break;
      }
    } finally {
      lock.release();
      await client.logout();
    }
    return { items, cursor: String(maxUid) };
  }

  private async client(conn: SourceConnection, secret?: string) {
    const host = String(conn.config.host ?? "").trim().toLowerCase();
    const port = Number(conn.config.port ?? 993);
    if (!host) throw new ValidationError("Falta el servidor del buzón.");
    if (![993, 143].includes(port)) throw new ValidationError("El buzón tiene que usar el puerto de IMAP (993, o 143).");
    let address = host;
    if (!this.opts.allowPrivate) {
      const ips = isIP(host) ? [host] : await (this.opts.resolve ?? resolveAll)(host).catch(() => []);
      if (!ips.length) throw new ValidationError(`No existe el servidor ${host}.`);
      if (!ips.every(isPublicAddress)) throw new ValidationError("Ese servidor no es público: no se accede a redes internas.");
      address = ips[0]!;
    }
    return new ImapFlow({
      host: address,
      servername: isIP(host) ? undefined : host, // el certificado se valida contra el nombre
      port,
      secure: port === 993 && conn.config.secure !== "false",
      auth: { user: conn.config.user!, pass: secret ?? "" },
      logger: false,
    });
  }
}

// ---------------- Extractores de texto de adjuntos ----------------

export class PlainTextExtractor implements IDocumentTextExtractor {
  supports(contentType: string) {
    return contentType.startsWith("text/plain") || contentType === "text/markdown" || contentType === "text/csv";
  }
  async extract(data: Buffer) {
    return data.toString("utf8");
  }
}

export class HtmlTextExtractor implements IDocumentTextExtractor {
  supports(contentType: string) {
    return contentType.startsWith("text/html");
  }
  async extract(data: Buffer) {
    return htmlToText(data.toString("utf8"));
  }
}

const resolveAll = async (host: string) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
