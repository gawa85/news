/**
 * Reglas de URL que define el usuario para una búsqueda.
 *
 * Cada patrón puede ser:
 *  - un dominio:            "diariodelsur.com.ar"         (incluye subdominios: www., m., etc.)
 *  - un dominio + ruta:     "diariodelsur.com.ar/opinion" (esa sección y todo lo que cuelga)
 *  - una URL completa:      "https://diariodelsur.com.ar/nota/123"
 */
export interface UrlRules {
  /** Notas puntuales que SIEMPRE entran en la comparación, aunque la búsqueda no las encuentre. */
  include?: string[];
  /** Si se indica, la búsqueda SOLO usa estos dominios o secciones. */
  onlyFrom?: string[];
  /** Dominios, secciones o notas que NUNCA entran. Gana sobre `onlyFrom`. */
  exclude?: string[];
}

interface ParsedPattern {
  host: string;
  path: string;
}

function parse(input: string): ParsedPattern | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
    return {
      host: u.hostname.toLowerCase().replace(/^www\./, ""),
      path: u.pathname.replace(/\/+$/, "").toLowerCase(),
    };
  } catch {
    return null;
  }
}

export function isValidUrlPattern(pattern: string): boolean {
  return parse(pattern) !== null;
}

/** ¿La URL coincide con el patrón (mismo dominio o subdominio, y ruta que empieza igual)? */
export function urlMatches(url: string, pattern: string): boolean {
  const u = parse(url);
  const p = parse(pattern);
  if (!u || !p) return false;
  const hostOk = u.host === p.host || u.host.endsWith(`.${p.host}`);
  const pathOk = p.path === "" || u.path === p.path || u.path.startsWith(`${p.path}/`);
  return hostOk && pathOk;
}

/** Aplica `onlyFrom` y `exclude` a los resultados de una búsqueda. */
export function passesUrlRules(url: string, rules: UrlRules | undefined): boolean {
  if (!rules) return true;
  if (rules.exclude?.some((p) => urlMatches(url, p))) return false;
  if (rules.onlyFrom?.length && !rules.onlyFrom.some((p) => urlMatches(url, p))) return false;
  return true;
}

/** Normaliza una URL para detectar duplicados (sin www, sin barra final, sin parámetros de tracking). */
export function canonicalUrl(url: string): string {
  const p = parse(url);
  return p ? `${p.host}${p.path}` : url.trim().toLowerCase();
}
