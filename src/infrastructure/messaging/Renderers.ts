/**
 * Un RENDERER por canal: la misma respuesta neutra se ve distinta en cada uno.
 */
import type { ChannelType, OutboundMessage, ResponseContent } from "../../domain/model";
import type { IChannelRenderer } from "../../domain/ports";

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const note = "\n…(respuesta recortada: pedí el detalle en la web)";
  return text.slice(0, max - note.length) + note;
}

/** WhatsApp: *negrita*, viñetas, máximo 4096 caracteres. */
export class WhatsAppRenderer implements IChannelRenderer {
  readonly channel = "whatsapp" as const;

  render(c: ResponseContent, to: string): OutboundMessage {
    const parts = [`*${c.title}*`];
    if (c.summary) parts.push(c.summary);
    for (const s of c.sections) parts.push([s.heading ? `*${s.heading}*` : "", ...s.lines.map((l) => `• ${l}`)].filter(Boolean).join("\n"));
    if (c.links.length) parts.push(c.links.map((l) => `${l.label}: ${l.url}`).join("\n"));
    if (c.footer) parts.push(`_${c.footer}_`);
    const brand = brandLine(c);
    if (brand) parts.push(`_${brand}_`);
    return { channel: this.channel, to, text: truncate(parts.join("\n\n"), 4096), ...(c.brand ? { fromName: c.brand.name } : {}), ...(c.audio ? { audio: { url: c.audio.url, mime: c.audio.mime } } : {}) };
  }
}

/** "Diario Norte · con tecnología de Sin Humo" (marca blanca). */
export function brandLine(c: ResponseContent): string | undefined {
  if (!c.brand) return undefined;
  return [c.brand.footer ?? c.brand.name, c.brand.poweredBy ? "con tecnología de Sin Humo" : undefined].filter(Boolean).join(" · ");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Telegram: HTML simple (<b>, <i>, <a>), máximo 4096 caracteres. */
export class TelegramRenderer implements IChannelRenderer {
  readonly channel = "telegram" as const;

  render(c: ResponseContent, to: string): OutboundMessage {
    const parts = [`<b>${esc(c.title)}</b>`];
    if (c.summary) parts.push(esc(c.summary));
    for (const s of c.sections) parts.push([s.heading ? `<b>${esc(s.heading)}</b>` : "", ...s.lines.map((l) => `• ${esc(l)}`)].filter(Boolean).join("\n"));
    if (c.links.length) parts.push(c.links.map((l) => `<a href="${esc(l.url)}">${esc(l.label)}</a>`).join(" · "));
    if (c.footer) parts.push(`<i>${esc(c.footer)}</i>`);
    const brand = brandLine(c);
    if (brand) parts.push(`<i>${esc(brand)}</i>`);
    return { channel: this.channel, to, text: truncate(parts.join("\n\n"), 4096), ...(c.brand ? { fromName: c.brand.name } : {}), ...(c.audio ? { audio: { url: c.audio.url, mime: c.audio.mime } } : {}) };
  }
}

/** Mail: asunto + versión texto + versión HTML. Sin límite práctico de largo. */
export class EmailRenderer implements IChannelRenderer {
  readonly channel = "email" as const;

  render(c: ResponseContent, to: string): OutboundMessage {
    const text = [
      c.title,
      c.summary ?? "",
      ...c.sections.map((s) => [s.heading?.toUpperCase() ?? "", ...s.lines.map((l) => `- ${l}`)].filter(Boolean).join("\n")),
      c.links.map((l) => `${l.label}: ${l.url}`).join("\n"),
      c.footer ?? "",
      c.audio ? `Escuchá esta respuesta: ${c.audio.url}` : "",
      brandLine(c) ?? "",
    ].filter(Boolean).join("\n\n");

    const b = c.brand;
    const header = b
      ? `<div style="border-bottom:4px solid ${esc(b.color ?? "#1d1d1f")};padding:0 0 8px;margin:0 0 16px">${b.logoUrl ? `<img src="${esc(b.logoUrl)}" alt="${esc(b.name)}" height="32">` : `<strong>${esc(b.name)}</strong>`}</div>`
      : "";
    const html = `<div lang="es" style="font-family:system-ui,sans-serif;max-width:640px;line-height:1.5;color:#1d1d1f">
${header}<h2 style="margin:0 0 8px">${esc(c.title)}</h2>
${c.summary ? `<p>${esc(c.summary)}</p>` : ""}
${c.sections.map((s) => `${s.heading ? `<h3 style="margin:16px 0 4px;font-size:15px">${esc(s.heading)}</h3>` : ""}<ul>${s.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`).join("\n")}
${c.links.length ? `<p>${c.links.map((l) => `<a href="${esc(l.url)}">${esc(l.label)}</a>`).join(" · ")}</p>` : ""}
${c.audio ? `<p><a href="${esc(c.audio.url)}">🔊 Escuchá esta respuesta</a></p>` : ""}
${c.footer ? `<p style="color:#595959;font-size:13px">${esc(c.footer)}</p>` : ""}
${brandLine(c) ? `<p style="color:#595959;font-size:12px">${esc(brandLine(c)!)}</p>` : ""}
</div>`;
    return { channel: this.channel, to, subject: c.title, text, html, ...(b ? { fromName: b.emailFromName ?? b.name } : {}) };
  }
}

/** Texto plano para SMS, web o API. */
export class PlainTextRenderer implements IChannelRenderer {
  constructor(
    readonly channel: ChannelType,
    private readonly maxLength = 1600,
  ) {}

  render(c: ResponseContent, to: string): OutboundMessage {
    const text = [c.title, c.summary, ...c.sections.flatMap((s) => [s.heading, ...s.lines.map((l) => `- ${l}`)]), ...c.links.map((l) => l.url), c.footer, brandLine(c)]
      .filter(Boolean)
      .join("\n");
    return { channel: this.channel, to, text: truncate(text, this.maxLength), ...(c.brand ? { fromName: c.brand.name } : {}) };
  }
}
