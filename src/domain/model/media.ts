/**
 * VERIFICAR IMÁGENES Y VIDEOS sin servicios externos: qué dicen sus datos internos y si ya
 * circularon antes (huella). No se guarda el archivo: sólo su huella, que no permite reconstruirlo.
 */

export type MediaKind = "image" | "video";

/** Lo que se lee del archivo (lo extrae un adaptador; las reglas deciden qué significa). */
export interface MediaInspection {
  kind: MediaKind;
  mime: string;
  bytes: number;
  /** Huella exacta (mismo archivo). */
  sha256: string;
  /** Huella perceptual (64 bits en hex): igual aunque se recomprima o cambie de tamaño. Sólo imágenes. */
  perceptualHash?: string;
  width?: number;
  height?: number;
  /** Cuándo se sacó la foto o se grabó el video, según el archivo. */
  capturedAt?: Date;
  /** Cámara o teléfono. */
  device?: string;
  /** Programa que la guardó (editor, generador, recodificador). */
  software?: string[];
  /** Marca estándar de contenido generado por IA (IPTC DigitalSourceType) o del generador. */
  aiMarkers?: string[];
  /** Credenciales de contenido (C2PA): presentes, y quién las generó si se lee. */
  contentCredentials?: { present: boolean; generator?: string };
  /** ¿Trae ubicación? (sólo se informa que existe, nunca cuál es). */
  hasLocation?: boolean;
  /** Duración del video, en segundos. */
  seconds?: number;
}

/** Una vez vista antes (por huella exacta o parecida). */
export interface MediaSighting {
  firstSeenAt: Date;
  lastSeenAt: Date;
  times: number;
  /** "same" = mismo archivo; "similar" = misma imagen recomprimida o recortada levemente. */
  match: "same" | "similar";
}

export interface MediaSignal {
  id: "seen_before" | "old_capture" | "ai_generated" | "edited" | "reencoded" | "content_credentials" | "location" | "no_metadata";
  level: "info" | "warning";
  label: string;
  detail: string;
}

export interface MediaReport {
  kind: MediaKind;
  signals: MediaSignal[];
  /** Resumen en una línea para la respuesta. */
  summary: string;
}

/** Registro de huellas (sin la imagen, sin quién la mandó). */
export interface MediaFingerprint {
  /** sha256 del archivo. */
  id: string;
  kind: MediaKind;
  perceptualHash?: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  times: number;
}
