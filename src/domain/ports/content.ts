/**
 * Puertos de FUENTES DE CONTENIDO.
 *
 * Dos formas de que entre contenido:
 *  - PULL: el sistema va a buscarlo (IContentSource: IMAP, RSS, una página...).
 *  - PUSH: llega solo (un servidor SMTP que recibe mails reenviados, un webhook).
 *    El adaptador de entrada convierte lo recibido con un parser (IMimeParser)
 *    y llama al caso de uso.
 *
 * Sumar una fuente = una clase que implemente IContentSource (o un parser + un
 * adaptador de entrada). El análisis no cambia.
 */
import type { ContentAnalysis, ContentItem, ContentSourceType, SourceConnection, SourceSignal } from "../model";

export interface PullResult {
  items: ContentItem[];
  /** Nuevo cursor para la próxima lectura. */
  cursor?: string;
}

export interface IContentSource {
  readonly type: ContentSourceType;
  /** Trae lo nuevo desde `connection.cursor`. `secret` = contraseña o token, ya descifrado. */
  pull(connection: SourceConnection, secret?: string): Promise<PullResult>;
  /** Verifica que la configuración y credenciales funcionan (al conectar). */
  test(connection: SourceConnection, secret?: string): Promise<void>;
}

/** Convierte un mail crudo (formato MIME / RFC 5322) en un ContentItem. */
export interface IMimeParser {
  parse(raw: Buffer | string): Promise<ContentItem>;
}

/** Extrae texto de adjuntos (PDF, Word...). Uno por formato. */
export interface IDocumentTextExtractor {
  supports(contentType: string): boolean;
  extract(data: Buffer): Promise<string>;
}

/**
 * Señales sobre la fuente de un contenido. Cada proveedor mira un aspecto:
 * autenticación del mail, links, cadena de reenvíos, si el origen es un medio conocido...
 */
export interface ISignalProvider {
  appliesTo(item: ContentItem): boolean;
  signals(item: ContentItem): Promise<SourceSignal[]>;
}

export interface IContentAnalysisRepository {
  save(analysis: ContentAnalysis): Promise<void>;
  findById(id: string): Promise<ContentAnalysis | undefined>;
  findByUser(userId: string, limit: number): Promise<ContentAnalysis[]>;
  /** Para la conexión con BI: análisis de varias personas desde una fecha, en orden. */
  findByUsersSince(userIds: string[], since: Date, limit: number): Promise<ContentAnalysis[]>;
  deleteByUser(userId: string): Promise<void>;
  deleteOlderThan(date: Date): Promise<void>;
}

export interface ISourceConnectionRepository {
  findById(id: string): Promise<SourceConnection | undefined>;
  findByUser(userId: string): Promise<SourceConnection[]>;
  findActive(): Promise<SourceConnection[]>;
  save(connection: SourceConnection): Promise<void>;
  deleteByUser(userId: string): Promise<void>;
}

/**
 * Bóveda de secretos (contraseñas IMAP, tokens). Guarda cifrado y devuelve una referencia.
 * En producción: un servicio de gestión de claves (KMS, Vault) detrás de esta interfaz.
 */
export interface ISecretVault {
  put(plaintext: string): Promise<string>;
  get(ref: string): Promise<string | undefined>;
  delete(ref: string): Promise<void>;
}

export interface HttpResponse {
  status: number;
  text: string;
  headers: Record<string, string>;
}

/** HTTP mínimo: todas las integraciones lo usan, así se prueban sin red. */
export interface IHttpClient {
  get(url: string, headers?: Record<string, string>): Promise<HttpResponse>;
  send(method: "POST" | "PUT" | "PATCH" | "DELETE", url: string, body: unknown, headers?: Record<string, string>): Promise<HttpResponse>;
}
