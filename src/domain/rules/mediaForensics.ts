/**
 * Reglas puras para leer una imagen o un video. Principio: ninguna señal PRUEBA que algo sea
 * falso; cada una dice qué se sabe y qué conviene mirar. Sin datos no se concluye nada
 * (WhatsApp, por ejemplo, borra los datos internos de todas las fotos).
 */
import type { MediaInspection, MediaReport, MediaSighting, MediaSignal } from "../model/media";

/** Distancia entre dos huellas perceptuales de 64 bits (hex). */
export function hammingDistance(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < 16; i += 4) {
    let x = parseInt(a.slice(i, i + 4), 16) ^ parseInt(b.slice(i, i + 4), 16);
    while (x) {
      d += x & 1;
      x >>>= 1;
    }
  }
  return d;
}

/** Hasta esta distancia se considera la misma imagen (recomprimida, achicada, con poco recorte). */
export const SIMILAR_MAX_DISTANCE = 6;

/**
 * ¿El cuadro dice algo? Una pantalla lisa (negro, un fundido, un color) tiene casi todos los bits
 * de la huella iguales: se parece a cualquier otra pantalla lisa y no sirve para reconocer un video.
 */
export function isInformativeHash(hash: string): boolean {
  let bits = 0;
  for (let i = 0; i < hash.length; i += 4) {
    let x = parseInt(hash.slice(i, i + 4), 16);
    while (x) {
      bits += x & 1;
      x >>>= 1;
    }
  }
  return bits >= 6 && bits <= 58;
}

/** Las huellas perceptuales de algo: la de la imagen, o las de los cuadros del video. */
export function perceptualHashesOf(x: { perceptualHash?: string; frameHashes?: string[] }): string[] {
  return x.frameHashes?.length ? x.frameHashes : x.perceptualHash ? [x.perceptualHash] : [];
}

/**
 * ¿Es el mismo material? Cuántas huellas de `mine` tienen una casi igual en `theirs`.
 * - Si alguno de los dos es una sola imagen: alcanza con un cuadro (una captura de un video).
 * - Entre dos videos: al menos 2 cuadros y un cuarto de los del más corto (un cuadro parecido
 *   solo —una pantalla negra, un logo— no alcanza).
 */
export function sameFootage(mine: string[], theirs: string[]): boolean {
  if (!mine.length || !theirs.length) return false;
  const hits = mine.filter((a) => theirs.some((b) => hammingDistance(a, b) <= SIMILAR_MAX_DISTANCE)).length;
  if (mine.length === 1 || theirs.length === 1) return hits >= 1;
  return hits >= 2 && hits >= Math.ceil(Math.min(mine.length, theirs.length) / 4);
}

/**
 * Partes de la huella para buscar parecidas en la base: 8 partes de 8 bits. Si dos huellas
 * difieren en ≤ 7 bits, al menos una parte coincide exacta (y se compara entera después).
 */
export function hashBands(hash: string): string[] {
  return Array.from({ length: 8 }, (_, i) => `${i}:${hash.slice(i * 2, i * 2 + 2)}`);
}

const AI_GENERATORS = /dall[-·]?e|midjourney|stable ?diffusion|sdxl|comfyui|automatic1111|firefly|imagen|gemini|openai|chatgpt|leonardo|ideogram|flux|runway|sora|kling|pika|grok/i;
const EDITORS = /photoshop|lightroom|gimp|snapseed|picsart|canva|facetune|pixelmator|affinity|photopea|capcut|premiere|after effects|final cut|davinci/i;
const REENCODERS = /lavf|ffmpeg|handbrake|x264|x265/i;

const fmt = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join("/");

export function mediaSignals(i: MediaInspection, now: Date, seen?: MediaSighting, channel?: string): MediaSignal[] {
  const out: MediaSignal[] = [];
  const what = i.kind === "image" ? "imagen" : "video";

  if (seen && seen.firstSeenAt.getTime() < now.getTime() - 86_400_000) {
    out.push({ id: "seen_before", level: "warning", label: "Ya circuló antes", detail: seenBeforeText(i.kind, seen) });
  }

  const ai = [...(i.aiMarkers ?? []), ...(i.software ?? []).filter((s) => AI_GENERATORS.test(s)), ...(i.contentCredentials?.generator && AI_GENERATORS.test(i.contentCredentials.generator) ? [i.contentCredentials.generator] : [])];
  if (ai.length) {
    out.push({ id: "ai_generated", level: "warning", label: "Hecha o modificada con IA", detail: `Los datos del archivo lo dicen (${[...new Set(ai)].join(", ")}). No es una foto o grabación de algo que pasó.` });
  }

  if (i.capturedAt && i.capturedAt.getTime() < now.getTime() - 365 * 86_400_000) {
    out.push({ id: "old_capture", level: "warning", label: `Es del ${fmt(i.capturedAt)}`, detail: `Según el archivo, se ${i.kind === "image" ? "sacó" : "grabó"} hace más de un año. Fijate si la presentan como reciente.` });
  }

  const editors = (i.software ?? []).filter((s) => EDITORS.test(s) && !AI_GENERATORS.test(s));
  if (editors.length) {
    out.push({ id: "edited", level: "info", label: "Pasó por un editor", detail: `Se guardó con ${[...new Set(editors)].join(", ")}. No prueba que esté trucada (se usan para recortar o ajustar la luz), pero vale mirarla con cuidado.` });
  }

  const reenc = (i.software ?? []).filter((s) => REENCODERS.test(s));
  if (i.kind === "video" && reenc.length) {
    out.push({ id: "reencoded", level: "info", label: "Fue re-editado", detail: "El video se volvió a procesar con un programa de edición o conversión (no salió así de la cámara)." });
  }

  if (i.contentCredentials?.present) {
    out.push({
      id: "content_credentials", level: "info", label: "Tiene credenciales de contenido (C2PA)",
      detail: `Trae el historial de cómo se hizo${i.contentCredentials.generator ? ` (${i.contentCredentials.generator})` : ""}. Se puede ver completo en contentcredentials.org/verify.`,
    });
  }

  if (i.hasLocation) {
    out.push({ id: "location", level: "info", label: "Trae la ubicación", detail: "El archivo guarda dónde se tomó. Ojo si lo compartís: revela ese lugar." });
  }

  const noMeta = !i.capturedAt && !i.device && !(i.software?.length) && !i.contentCredentials?.present;
  if (noMeta && !out.some((s) => s.id === "seen_before" || s.id === "ai_generated")) {
    out.push({
      id: "no_metadata", level: "info", label: "Sin datos internos",
      detail: channel === "whatsapp" || channel === "telegram"
        ? `${channel === "whatsapp" ? "WhatsApp" : "Telegram"} borra los datos internos de las ${what === "imagen" ? "fotos" : "grabaciones"}: por sí solo no dice nada. Buscá el original (quién la publicó primero y cuándo).`
        : "No trae fecha, cámara ni programa. No prueba nada: muchas redes los borran. Buscá quién la publicó primero.",
    });
  }
  return out;
}

export function mediaReport(i: MediaInspection, now: Date, seen?: MediaSighting, channel?: string): MediaReport {
  const signals = mediaSignals(i, now, seen, channel);
  const warnings = signals.filter((s) => s.level === "warning");
  const summary = warnings.length
    ? `Ojo: ${warnings.map((w) => w.label.toLowerCase()).join(" · ")}.`
    : `No encontramos señales de ${i.kind === "image" ? "imagen" : "video"} reciclado o generado con IA (eso no garantiza que sea auténtico).`;
  return { kind: i.kind, signals, summary };
}

/** "Ya circuló antes", en palabras: mismo archivo, casi igual, o una foto que es un cuadro de un video (y al revés). */
function seenBeforeText(kind: MediaInspection["kind"], seen: MediaSighting): string {
  const when = fmt(seen.firstSeenAt);
  if (seen.otherKind && seen.otherKind !== kind) {
    return kind === "image"
      ? `Esta imagen es un cuadro de un video que nos llegó por primera vez el ${when}. Si la presentan como una foto de hoy, puede ser una captura de un video viejo.`
      : `Este video contiene una imagen que nos llegó por primera vez el ${when}. Si lo presentan como grabado hoy, puede estar armado con material viejo.`;
  }
  const times = seen.times > 1 ? ` y la vimos ${seen.times} veces` : "";
  if (kind === "image") {
    return `Esta imagen ${seen.match === "same" ? "" : "(o una casi igual) "}nos llegó por primera vez el ${when}${times}. Si la presentan como de hoy, puede ser vieja.`;
  }
  const similar = seen.match === "same" ? "" : "(o uno con las mismas escenas, aunque esté recomprimido o recortado) ";
  return `Este video ${similar}nos llegó por primera vez el ${when}${times.replace("la vimos", "lo vimos")}. Si lo presentan como de hoy, puede ser viejo.`;
}
