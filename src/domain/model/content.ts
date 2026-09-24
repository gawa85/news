/**
 * CONTENIDO GENÉRICO: cualquier cosa que se pueda analizar, venga de donde venga.
 * Mail, página web, RSS, mensaje reenviado de WhatsApp, publicación de una red,
 * documento... Cada fuente lo convierte en un ContentItem y a partir de ahí
 * el análisis es el mismo.
 */
export type ContentSourceType = "email" | "web" | "rss" | "message" | "social" | "document";

export interface ContentOrigin {
  name?: string;
  /** Mail del remitente, usuario de la red, URL del feed... */
  address?: string;
  domain?: string;
}

export interface ContentAttachment {
  filename: string;
  contentType: string;
  size: number;
  /** Texto extraído, si hay un extractor para ese formato. */
  text?: string;
}

export interface ContentItem {
  id: string;
  sourceType: ContentSourceType;
  /** Conexión que lo trajo (buzón IMAP, feed...), si vino de una. */
  connectionId?: string;
  origin: ContentOrigin;
  title?: string;
  text: string;
  html?: string;
  urls: string[];
  publishedAt: Date;
  receivedAt: Date;
  /** Si es un reenvío: quién lo escribió originalmente. */
  forwardedFrom?: ContentOrigin & { date?: string };
  attachments: ContentAttachment[];
  /** Datos propios de la fuente (encabezados del mail, id del post, etc.). */
  metadata: Record<string, string>;
}

/** Señal sobre la FUENTE del contenido (no sobre el texto): remitente verificado, links raros... */
export interface SourceSignal {
  id: string;
  level: "ok" | "info" | "warning" | "danger";
  label: string;
  detail: string;
}

export interface AnalyzedLink {
  url: string;
  domain: string;
  /** Si el dominio es un medio registrado. */
  outletId?: string;
}

export interface ContentAnalysis {
  id: string;
  userId: string;
  item: ContentItem;
  smoke: import("./smoke").SmokeAnalysis;
  signals: SourceSignal[];
  links: AnalyzedLink[];
  analyzedAt: Date;
  /** Versión del algoritmo que hizo el análisis (reproducibilidad). */
  modelVersion?: string;
}

/**
 * Conexión a una fuente que se consulta periódicamente (buzón IMAP, feed RSS...).
 * Las credenciales NO se guardan acá: sólo una referencia a la bóveda de secretos.
 */
export interface SourceConnection {
  id: string;
  userId: string;
  type: ContentSourceType;
  name: string;
  /** Configuración no secreta: host, puerto, carpeta, URL del feed. */
  config: Record<string, string>;
  secretRef?: string;
  /** Hasta dónde se leyó (último UID de IMAP, fecha del último ítem del feed...). */
  cursor?: string;
  active: boolean;
  lastSyncAt?: Date;
  createdAt: Date;
}
