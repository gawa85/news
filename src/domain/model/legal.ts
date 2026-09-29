/**
 * DOCUMENTOS LEGALES versionados y su aceptación.
 * Un cambio "material" (que afecta derechos) exige volver a aceptar; uno menor sólo se informa.
 */
export type LegalDocId = "terms" | "privacy";

export interface LegalDocument {
  id: LegalDocId;
  title: string;
  version: string;
  publishedAt: Date;
  /** Si cambia algo importante (precios, datos, responsabilidad), hay que volver a aceptar. */
  material: boolean;
  url: string;
  summary: string;
  /** Mientras sea borrador, se muestra el aviso. */
  draft: boolean;
  /** Texto completo (Markdown simple: títulos, párrafos, listas, citas, negrita). */
  body?: string;
  /** Quién publicó esta versión desde el backoffice (las del código: "sistema"). Interno. */
  publishedBy?: string;
}

export const LEGAL_DOC_IDS: LegalDocId[] = ["terms", "privacy"];

export interface ConsentRecord {
  id: string; // `${userId}|${docId}|${version}`
  userId: string;
  docId: LegalDocId;
  version: string;
  method: "click" | "chat_notice" | "api";
  channel: string;
  at: Date;
}
