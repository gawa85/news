import type { BillingInterval } from "./commerce";
import type { Price } from "./plans";

/**
 * PAÍSES: moneda, impuestos, identificación fiscal, regiones, zona horaria y precios.
 * Es configuración (config/countries.ts): sumar un país no toca el código.
 */
export type TaxIdKind = "ar_cuit" | "uy_rut" | "cl_rut" | "mx_rfc" | "none";

export interface CountryConfig {
  code: string;
  name: string;
  currency: string;
  locale: string;
  /** Diferencia con UTC en minutos (Argentina: -180). */
  utcOffsetMinutes: number;
  /** Provincias, departamentos, regiones o estados. */
  regions: { code: string; name: string }[];
  tax: { name: string; rate: number; includedInPrice: boolean };
  taxId: { name: string; kind: TaxIdKind };
  /** Cómo se factura: ARCA (Argentina) o comprobante no fiscal hasta integrar al proveedor local. */
  invoicing: "arca" | "receipt_only";
  dataProtection: string;
  /** Autoridad electoral (para vedas y temas sensibles). */
  electoralAuthority?: string;
  /** Precios locales por plan (si no hay, se usa el precio del plan). */
  planPrices?: Record<string, Partial<Record<BillingInterval, Price>>>;
}

export const normalizeRegion = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
