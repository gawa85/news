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
}

export interface ConsentRecord {
  id: string; // `${userId}|${docId}|${version}`
  userId: string;
  docId: LegalDocId;
  version: string;
  method: "click" | "chat_notice" | "api";
  channel: string;
  at: Date;
}
