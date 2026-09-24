import type { BillingProfile, BillingSubject, Invoice } from "../model";

export interface IBillingProfileRepository {
  find(subject: BillingSubject): Promise<BillingProfile | undefined>;
  save(profile: BillingProfile): Promise<void>;
}

export interface IInvoiceRepository {
  findById(id: string): Promise<Invoice | undefined>;
  findBySubject(subject: BillingSubject): Promise<Invoice[]>;
  save(invoice: Invoice): Promise<void>;
}

/**
 * Emisor de comprobantes electrónicos. En Argentina: ARCA (ex AFIP) con los web services
 * WSAA (autenticación con certificado) + WSFEv1 (factura electrónica), que devuelven el CAE.
 */
export interface IInvoiceIssuer {
  issue(invoice: Invoice): Promise<{ number: number; cae: string; caeExpiry: string }>;
}
