/**
 * Tipos básicos compartidos por todo el dominio.
 * El dominio NO depende de nada externo (ni frameworks, ni APIs, ni bases de datos).
 */

export interface Period {
  from: Date;
  to: Date;
}

/** Ubicación geográfica: país, provincia y localidad (estas dos últimas opcionales). */
export interface Region {
  country: string;
  province?: string;
  locality?: string;
}

export function isInPeriod(date: Date, period: Period): boolean {
  return date.getTime() >= period.from.getTime() && date.getTime() <= period.to.getTime();
}

export function monthsInPeriod(period: Period): number {
  const ms = period.to.getTime() - period.from.getTime();
  return Math.max(1, ms / (1000 * 60 * 60 * 24 * 30.44));
}

/** ¿La región `inner` está contenida en `outer`? (Neuquén capital ⊂ Neuquén ⊂ Argentina) */
export function regionContains(outer: Region, inner: Region): boolean {
  if (outer.country !== inner.country) return false;
  if (outer.province && outer.province !== inner.province) return false;
  if (outer.locality && outer.locality !== inner.locality) return false;
  return true;
}

export function regionLabel(r: Region): string {
  return [r.locality, r.province, r.country].filter(Boolean).join(", ");
}
