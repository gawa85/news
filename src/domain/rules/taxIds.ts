/**
 * Validación de identificaciones fiscales por país (dígitos verificadores).
 */
import type { TaxIdKind } from "../model";
import { isValidCuit } from "./invoiceRules";

/** RUT de Chile: cuerpo + dígito verificador (0-9 o K), módulo 11. */
export function isValidChileRut(raw: string): boolean {
  const s = raw.replace(/[.\s-]/g, "").toUpperCase();
  if (!/^\d{7,8}[\dK]$/.test(s)) return false;
  const body = s.slice(0, -1);
  let sum = 0;
  let mul = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const r = 11 - (sum % 11);
  const dv = r === 11 ? "0" : r === 10 ? "K" : String(r);
  return dv === s.at(-1);
}

/** RUT de Uruguay: 12 dígitos, verificador módulo 11 con pesos 4,3,2,9,8,7,6,5,4,3,2. */
export function isValidUruguayRut(raw: string): boolean {
  const s = raw.replace(/\D/g, "");
  if (!/^\d{12}$/.test(s)) return false;
  const weights = [4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(s[i]), 0);
  const r = 11 - (sum % 11);
  const dv = r === 11 ? 0 : r === 10 ? 1 : r;
  return dv === Number(s[11]);
}

/** RFC de México: formato (persona moral 12, física 13). La homoclave no se verifica. */
export function isValidMexicoRfc(raw: string): boolean {
  return /^[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}$/.test(raw.trim().toUpperCase());
}

export function isValidTaxId(kind: TaxIdKind, value: string): boolean {
  switch (kind) {
    case "ar_cuit": return isValidCuit(value);
    case "cl_rut": return isValidChileRut(value);
    case "uy_rut": return isValidUruguayRut(value);
    case "mx_rfc": return isValidMexicoRfc(value);
    case "none": return value.trim().length > 0;
  }
}
