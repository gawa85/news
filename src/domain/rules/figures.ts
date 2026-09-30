import type { Claim } from "../model";

/**
 * Las CIFRAS de una afirmación: sus números, sin los años (2026 aparece en todas las notas
 * del año y no dice nada del dato).
 */
export function figuresOf(claim: Pick<Claim, "numbers">): number[] {
  return claim.numbers.filter((n) => !(Number.isInteger(n) && n >= 1900 && n <= 2100));
}

/**
 * ¿Vale la pena cotejarla? Un dato (no una opinión) con alguna cifra y texto suficiente
 * para saber de qué habla ("1." no dice nada).
 */
export function isCheckable(claim: Claim): boolean {
  return claim.kind === "fact" && figuresOf(claim).length > 0 && claim.text.trim().length >= 30;
}

/** Cifras que se pueden comparar entre medios: porcentajes con porcentajes, montos con montos. */
export interface ComparableFigures {
  percent: number[];
  money: number[];
}

/** "3.000,5" (miles con punto, decimales con coma) o "2,1" o "1.7". */
function parseNumber(s: string): number {
  const t = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(",", ".");
  return Number(t);
}

const PERCENT = /(\d+(?:[.,]\d+)*)\s*(?:%|por\s*ciento)/gi;
const MONEY_SIGN = /(?:\$|u\$s|us\$|usd|€)\s*(\d+(?:[.,]\d+)*)(\s*(?:mil\s+millones|millones|mil|billones))?/gi;
const MONEY_WORD = /(\d+(?:[.,]\d+)*)\s*(mil\s+millones|millones|billones)\s+(?:de\s+)?(?:pesos|d[oó]lares|euros)/gi;
const SCALE: Record<string, number> = { mil: 1e3, millones: 1e6, "mil millones": 1e9, billones: 1e12 };

/**
 * Las cifras comparables de un texto. Números de ley, fechas, horas o ediciones ("Ley 26.737",
 * "el lunes 9", "62° Coloquio") no se comparan: dos notas pueden dar distintos sin contradecirse.
 */
export function comparableFigures(text: string): ComparableFigures {
  const percent = [...text.matchAll(PERCENT)].map((m) => parseNumber(m[1]!));
  const money: number[] = [];
  for (const m of text.matchAll(MONEY_SIGN)) money.push(parseNumber(m[1]!) * (SCALE[(m[2] ?? "").trim().toLowerCase().replace(/\s+/g, " ")] ?? 1));
  for (const m of text.matchAll(MONEY_WORD)) money.push(parseNumber(m[1]!) * SCALE[m[2]!.toLowerCase().replace(/\s+/g, " ")]!);
  const ok = (n: number) => Number.isFinite(n);
  return { percent: [...new Set(percent.filter(ok))], money: [...new Set(money.filter(ok))] };
}

const shares = (a: number[], b: number[]) => a.some((x) => b.some((y) => Math.abs(x - y) < 1e-9));

/** Dos afirmaciones sobre lo mismo coinciden en alguna cifra (sin contar años). */
export function figuresAgree(a: Pick<Claim, "numbers" | "text">, b: Pick<Claim, "numbers" | "text">): boolean {
  return shares(figuresOf(a), figuresOf(b));
}

/**
 * Dos afirmaciones sobre lo mismo dan cifras DISTINTAS: las dos tienen porcentajes (o montos)
 * y no comparten ninguno. Sólo así se dice que no coinciden: otros números no alcanzan.
 */
export function figuresDisagree(a: Pick<Claim, "numbers" | "text">, b: Pick<Claim, "numbers" | "text">): boolean {
  if (figuresAgree(a, b)) return false;
  const x = comparableFigures(a.text);
  const y = comparableFigures(b.text);
  return (x.percent.length > 0 && y.percent.length > 0 && !shares(x.percent, y.percent)) || (x.money.length > 0 && y.money.length > 0 && !shares(x.money, y.money));
}
