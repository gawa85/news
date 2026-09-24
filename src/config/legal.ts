import type { LegalDocument } from "../domain/model";

/**
 * Versiones vigentes de los documentos legales. El texto está en docs/legal/.
 * ⚠️ BORRADORES: tienen que revisarlos abogados antes de publicarse.
 */
export const LEGAL_DOCUMENTS: LegalDocument[] = [
  {
    id: "terms", title: "Términos y condiciones", version: "2026-09-borrador", publishedAt: new Date("2026-09-24T00:00:00Z"), material: true,
    url: "/legal/terminos", draft: true,
    summary: "Sin Humo analiza textos y fuentes con métodos automáticos que pueden equivocarse; las evaluaciones son opiniones fundadas con metodología pública y derecho a réplica.",
  },
  {
    id: "privacy", title: "Política de privacidad", version: "2026-09-borrador", publishedAt: new Date("2026-09-24T00:00:00Z"), material: true,
    url: "/legal/privacidad", draft: true,
    summary: "Qué datos guardamos, para qué, cuánto tiempo y cómo ejercer tus derechos (Ley 25.326).",
  },
];
