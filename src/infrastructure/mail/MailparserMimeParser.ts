import { randomUUID } from "node:crypto";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import type { ContentAttachment, ContentItem, ContentOrigin } from "../../domain/model";
import type { IDocumentTextExtractor, IMimeParser } from "../../domain/ports";

export interface MimeParserOptions {
  /**
   * Servidores cuyo encabezado Authentication-Results se considera confiable
   * (el propio MTA que recibe el mail). Los encabezados agregados por otros se ignoran:
   * cualquiera puede escribir uno falso en un mail.
   */
  trustedAuthServIds: string[];
  maxAttachmentBytes: number;
}

const FORWARD_MARKER = /-{2,}\s*(Forwarded message|Mensaje reenviado|Original Message|Mensaje original)\s*-{2,}/i;

/** Convierte un mail crudo (MIME) en un ContentItem, usando la librería mailparser. */
export class MailparserMimeParser implements IMimeParser {
  constructor(
    private readonly opts: MimeParserOptions,
    private readonly extractors: IDocumentTextExtractor[] = [],
  ) {}

  async parse(raw: Buffer | string): Promise<ContentItem> {
    const mail = await simpleParser(raw);
    const from = first(mail.from);
    const text = (mail.text ?? htmlToText(typeof mail.html === "string" ? mail.html : "")).trim();
    const auth = this.trustedAuthResults(mail);
    const now = new Date();

    return {
      id: randomUUID(),
      sourceType: "email",
      origin: { name: from?.name || undefined, address: from?.address, domain: from?.address?.split("@")[1]?.toLowerCase() },
      title: mail.subject,
      text: this.bodyWithoutQuotedHeaders(text),
      html: typeof mail.html === "string" ? mail.html : undefined,
      urls: extractUrls(text, typeof mail.html === "string" ? mail.html : ""),
      publishedAt: mail.date ?? now,
      receivedAt: now,
      forwardedFrom: detectForward(mail.subject ?? "", text),
      attachments: await this.attachments(mail),
      metadata: {
        "from-address": from?.address?.toLowerCase() ?? "",
        "from-name": from?.name ?? "",
        "message-id": mail.messageId ?? "",
        ...(first(mail.replyTo)?.address ? { "reply-to": first(mail.replyTo)!.address! } : {}),
        ...(auth ? { "authentication-results": auth } : {}),
        "sender-authenticated": String(isAuthenticated(auth)),
      },
    };
  }

  private trustedAuthResults(mail: ParsedMail): string | undefined {
    const raw = mail.headers.get("authentication-results");
    const values = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(String);
    const trusted = this.opts.trustedAuthServIds.map((s) => s.toLowerCase());
    return values.find((v) => trusted.includes(v.split(";")[0]!.trim().toLowerCase()));
  }

  private async attachments(mail: ParsedMail): Promise<ContentAttachment[]> {
    return Promise.all(
      mail.attachments.map(async (a) => {
        const extractor = a.size <= this.opts.maxAttachmentBytes ? this.extractors.find((e) => e.supports(a.contentType)) : undefined;
        return {
          filename: a.filename ?? "adjunto",
          contentType: a.contentType,
          size: a.size,
          text: extractor ? await extractor.extract(a.content).catch(() => undefined) : undefined,
        };
      }),
    );
  }

  /** En un reenvío, se analiza el mensaje ORIGINAL (se quita la línea separadora). */
  private bodyWithoutQuotedHeaders(text: string): string {
    return text.replace(FORWARD_MARKER, "").trim();
  }
}

function first(a: AddressObject | AddressObject[] | undefined) {
  return (Array.isArray(a) ? a[0] : a)?.value[0];
}

function isAuthenticated(auth: string | undefined): boolean {
  if (!auth) return false;
  const r = (m: string) => auth.toLowerCase().match(new RegExp(`${m}=(\\w+)`))?.[1];
  return r("dmarc") === "pass" || (r("spf") === "pass" && r("dkim") === "pass");
}

function detectForward(subject: string, text: string): (ContentOrigin & { date?: string }) | undefined {
  const marker = text.search(FORWARD_MARKER);
  if (marker < 0 && !/^(fwd?|rv|reenviado):/i.test(subject)) return undefined;
  const after = marker >= 0 ? text.slice(marker) : text;
  const fromLine = after.match(/^(?:From|De):\s*(.+)$/im)?.[1]?.trim();
  const date = after.match(/^(?:Date|Fecha|Sent|Enviado):\s*(.+)$/im)?.[1]?.trim();
  const m = fromLine?.match(/^"?([^"<]*)"?\s*<([^>]+)>/);
  const address = (m?.[2] ?? fromLine)?.toLowerCase();
  return {
    name: m?.[1]?.trim() || undefined,
    address,
    domain: address?.includes("@") ? address.split("@")[1] : undefined,
    date,
  };
}

function extractUrls(text: string, html: string): string[] {
  const fromHtml = [...html.matchAll(/href="(https?:\/\/[^"]+)"/gi)].map((m) => m[1]!);
  const fromText = text.match(/https?:\/\/[^\s<>")\]]+/g) ?? [];
  return [...new Set([...fromHtml, ...fromText].map((u) => u.replace(/[.,;]+$/, "")))];
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}
