/**
 * ARCHIVO DE EVIDENCIAS: reglas puras (sin red ni criptografía de proveedor).
 */
import type { EvidenceChange, EvidenceSnapshot } from "../model";

/** Parámetros de seguimiento: no cambian la nota (sí se conservan los demás: hay sitios con ?id=). */
const TRACKING = /^(utm_\w+|fbclid|gclid|dclid|msclkid|mc_[ce]id|igshid|ref_src|ref_url|_ga|s_cid|at_\w+|share|from)$/i;

/** Misma nota aunque cambien mayúsculas del dominio, "www.", el ancla o el seguimiento. */
export function evidenceUrlKey(url: string): string {
  const u = new URL(url);
  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  u.searchParams.sort();
  const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, "") : "";
  const query = u.searchParams.toString();
  return `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ""}${path}${query ? `?${query}` : ""}`;
}

/** Texto comparable: Unicode normalizado, espacios colapsados, sin líneas vacías. */
export function normalizeEvidenceText(text: string): string {
  return text
    .normalize("NFC")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function sentences(text: string): string[] {
  return text
    .split(/\n|(?<=[.!?¿¡…])\s+(?=[A-ZÁÉÍÓÚÑ¿¡"“0-9])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);
}

/** Qué frases aparecieron y cuáles desaparecieron (lo que importa en una edición silenciosa). */
export function compareEvidenceText(before: string, after: string, max = 20): EvidenceChange {
  const a = sentences(before);
  const b = sentences(after);
  const inA = new Set(a);
  const inB = new Set(b);
  return {
    added: b.filter((s) => !inA.has(s)).slice(0, max),
    removed: a.filter((s) => !inB.has(s)).slice(0, max),
  };
}

/**
 * Contenido de un registro que entra en su huella (todo lo que prueba qué se vio y cuándo).
 * Quedan afuera los datos que se agregan después (sello, copias externas, seguimiento) y quién
 * la pidió: es un dato personal que se borra a pedido (Ley 25.326) sin romper la cadena.
 */
export function evidenceRecordContent(s: Omit<EvidenceSnapshot, "recordHash">): string {
  return JSON.stringify([
    s.id, s.url, s.finalUrl, s.urlKey, s.capturedAt.toISOString(), s.reason, s.status,
    s.httpStatus ?? null, s.title ?? null, s.mime ?? null, s.bytes ?? null, s.rawSha256 ?? null, s.textSha256 ?? null,
    s.previousId ?? null, s.previousRecordHash ?? null,
  ]);
}
