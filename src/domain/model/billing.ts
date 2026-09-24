import type { BillingSubject } from "./plans";

/** Condición frente al IVA (Argentina). */
export type TaxCondition = "consumidor_final" | "responsable_inscripto" | "monotributista" | "exento";

/** Datos fiscales de quien paga. Sin perfil, se factura a "Consumidor Final". */
export interface BillingProfile {
  subject: BillingSubject;
  legalName: string;
  taxIdType: "CUIT" | "CUIL" | "DNI" | "RUT" | "RFC";
  taxId: string;
  taxCondition: TaxCondition;
  address?: string;
  email?: string;
  /** País fiscal (Argentina si falta). */
  country?: string;
  updatedAt: Date;
}

export type InvoiceLetter = "A" | "B" | "C";

export interface Invoice {
  /** "inv_<id de suscripción>": una factura por cobro (idempotente). */
  id: string;
  subject: BillingSubject;
  subscriptionId: string;
  letter: InvoiceLetter;
  pointOfSale: number;
  number?: number;
  issueDate: Date;
  buyer: { name: string; taxIdType: "CUIT" | "CUIL" | "DNI" | "SIN_IDENTIFICAR"; taxId?: string; taxCondition: TaxCondition };
  lines: { description: string; amount: number }[];
  net: number;
  vat: number;
  vatRate: number;
  total: number;
  currency: string;
  status: "pending" | "issued" | "failed";
  /** Código de Autorización Electrónico de ARCA y su vencimiento. */
  cae?: string;
  caeExpiry?: string;
  error?: string;
}
