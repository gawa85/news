import type { ContentItem } from "../model";

/** Por dónde llegó algo que se analizó. */
export type OriginKind = "feed" | "mailbox" | "email" | "whatsapp" | "telegram" | "web_text" | "web_link" | "social" | "document";

/**
 * DE DÓNDE VINO un análisis, para mostrárselo a la persona: por dónde llegó, quién lo publicó
 * o lo mandó y el link al original. Sale de lo que ya se guarda con cada análisis.
 */
export interface AnalysisOrigin {
  kind: OriginKind;
  /** Dicho en castellano: "Feed «Clarín» (clarin.com)", "Mail de Ana <ana@correo.com>", "WhatsApp, reenviado". */
  label: string;
  /** Fuente conectada que lo trajo, con el nombre que le puso la persona ("Clarín", "Mi Gmail"). */
  source?: string;
  /** Quién lo publicó o lo mandó: remitente de un mail, autor de una publicación. */
  author?: string;
  /** Sitio o dominio del original. */
  domain?: string;
  /** Link al original. */
  url?: string;
  /** Llegó reenviado (mail o chat). */
  forwarded: boolean;
  /** Muy reenviado (WhatsApp lo marca así). */
  forwardedManyTimes: boolean;
  /** Red social (x, facebook, instagram…). */
  platform?: string;
  /** Si el texto se sacó de una imagen o un audio. */
  extractedFrom?: string;
}

const firstUrl = (item: ContentItem) => item.urls.find((u) => /^https?:\/\//i.test(u));

const PLATFORMS: Record<string, string> = { x: "X (Twitter)", twitter: "X (Twitter)", facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", threads: "Threads", bluesky: "Bluesky", telegram: "Telegram" };
const EXTRACTED: Record<string, string> = { image: "de una imagen", voice: "de un audio" };

/** La descripción en castellano (la misma en la web, en el historial y en las exportaciones). */
export function originLabel(o: Omit<AnalysisOrigin, "label">): string {
  const quoted = (s?: string) => (s ? ` «${s}»` : "");
  const at = o.domain ? ` (${o.domain})` : "";
  let text: string;
  switch (o.kind) {
    case "feed": text = `Feed${quoted(o.source)}${at}`; break;
    case "mailbox": text = `Buzón${quoted(o.source)}${o.author ? `: mail de ${o.author}` : ""}`; break;
    case "email": text = o.author ? `Mail de ${o.author}` : "Mail"; break;
    case "whatsapp": text = "WhatsApp"; break;
    case "telegram": text = "Telegram"; break;
    case "web_text": text = "Texto pegado en la web"; break;
    case "web_link": text = o.domain ? `Link a ${o.domain}` : "Link"; break;
    case "social": text = `Publicación en ${PLATFORMS[o.platform ?? ""] ?? "una red social"}${o.author ? ` de ${o.author}` : ""}`; break;
    case "document": text = `Documento${quoted(o.source)}`; break;
  }
  const extra = [
    o.extractedFrom ? `texto sacado ${EXTRACTED[o.extractedFrom] ?? "de un archivo"}` : "",
    o.forwardedManyTimes ? "reenviado muchas veces" : o.forwarded ? "reenviado" : "",
  ].filter(Boolean);
  return extra.length ? `${text}, ${extra.join(", ")}` : text;
}

export function originOf(item: ContentItem, connectionName?: string): AnalysisOrigin {
  const o = describe(item, connectionName);
  return { ...o, label: originLabel(o) };
}

function describe(item: ContentItem, connectionName?: string): Omit<AnalysisOrigin, "label"> {
  const base = {
    forwarded: !!item.forwardedFrom,
    forwardedManyTimes: item.metadata["forwarded-many-times"] === "true",
    extractedFrom: item.metadata["extracted-from"] || undefined,
  };
  const who = (o: { name?: string; address?: string }) =>
    o.name && o.address && o.name !== o.address ? `${o.name} <${o.address}>` : o.name || o.address || undefined;

  switch (item.sourceType) {
    case "rss":
      return { ...base, kind: "feed", source: connectionName ?? item.origin.name, domain: item.origin.domain, url: firstUrl(item) };
    case "email":
      return {
        ...base,
        kind: item.connectionId ? "mailbox" : "email",
        source: connectionName,
        author: who(item.origin),
        domain: item.origin.domain,
      };
    case "social":
      return { ...base, kind: "social", platform: item.metadata.platform, author: who(item.origin), domain: item.origin.domain, url: firstUrl(item) };
    case "web":
      return { ...base, kind: "web_link", domain: item.origin.domain, url: item.origin.address ?? firstUrl(item) };
    case "document":
      return { ...base, kind: "document", source: connectionName };
    default: {
      // Un mensaje: por el chat (WhatsApp, Telegram) o pegado en la web. El número de quien
      // lo mandó es el de la propia persona: no se muestra.
      const channel = item.metadata.channel;
      return { ...base, kind: channel === "whatsapp" ? "whatsapp" : channel === "telegram" ? "telegram" : "web_text" };
    }
  }
}
