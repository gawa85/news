/**
 * REGLAS FISCALES de facturación (Argentina). Funciones puras: se prueban solas.
 *
 * Tipo de comprobante:
 *  - Emisor monotributista → siempre C (sin IVA discriminado).
 *  - Emisor responsable inscripto:
 *      comprador responsable inscripto o monotributista → A (IVA discriminado)
 *      consumidor final o exento → B
 * El precio de los planes se toma con IVA incluido.
 * (Conviene validar estas reglas con quien lleve la contabilidad.)
 */
import type { InvoiceLetter, TaxCondition } from "../model";

export function invoiceLetter(seller: "responsable_inscripto" | "monotributista", buyer: TaxCondition): InvoiceLetter {
  if (seller === "monotributista") return "C";
  return buyer === "responsable_inscripto" || buyer === "monotributista" ? "A" : "B";
}

/** Separa neto e IVA de un precio final. En C no se discrimina IVA. */
export function splitVat(total: number, letter: InvoiceLetter, rate: number): { net: number; vat: number } {
  if (letter === "C") return { net: round2(total), vat: 0 };
  const net = round2(total / (1 + rate));
  return { net, vat: round2(total - net) };
}

/** Valida un CUIT/CUIL con su dígito verificador (módulo 11). */
export function isValidCuit(raw: string): boolean {
  const d = raw.replace(/\D/g, "");
  if (d.length !== 11) return false;
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = w.reduce((s, x, i) => s + x * Number(d[i]), 0);
  let check = 11 - (sum % 11);
  if (check === 11) check = 0;
  if (check === 10) return false;
  return check === Number(d[10]);
}

const round2 = (n: number) => Math.round(n * 100) / 100;
