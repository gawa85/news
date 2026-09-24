import { createHmac } from "node:crypto";

/**
 * ANONIMIZADOR para copias que van a ambientes de prueba (staging): mismos volúmenes y
 * relaciones, sin datos personales. Es DETERMINÍSTICO (el mismo teléfono se reemplaza siempre
 * por el mismo número falso), así las relaciones entre tablas siguen funcionando.
 */

/** Colecciones públicas o de catálogo: se copian tal cual. */
const PUBLIC = new Set([
  "outlets", "articles", "claims", "verdicts", "owners", "ownership_records", "advertising_spend", "feed_sources", "plans", "roles",
  "topics", "categories", "quiz_items", "labeled_examples", "model_versions", "evaluation_runs", "business_parameters", "business_rules",
  "feature_flags", "official_documents", "corrections", "stat_counters", "platform_policies",
]);

/** Colecciones mixtas: se copian tal cual sólo los documentos curados por el equipo (no los que vienen de personas). */
const CURATED_ONLY: Record<string, (doc: Record<string, unknown>) => boolean> = {
  labeled_examples: (d) => d.source === "curated",
  quiz_items: (d) => d.source === "curated" || d.source === "evaluation_set",
};

/** Secretos y credenciales: NUNCA van a un ambiente de prueba. */
export const NEVER_TO_STAGING = new Set(["secrets", "api_keys", "webhooks", "source_connections", "stat_contributors", "legal_consents"]);

const SENSITIVE_KEYS = new Set([
  "name", "legalName", "displayName", "alias", "email", "phone", "taxId", "address", "text", "body", "html", "comment",
  "statement", "subject", "note", "title", "summary", "sample", "cleanVersion", "excerpt", "userAgent", "ip",
]);

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
/** Teléfonos con "+" o números largos (ids de chat): nunca fechas como 2026-09-24. */
const PHONE = /\+\d{8,15}\b|\b\d{9,15}\b/g;
const CONTACT_KEYS = new Set(["address", "email", "phone", "to", "from", "recipient"]);

export class Scrubber {
  constructor(private readonly secret: string) {}

  private h(v: string, n = 10): string {
    return createHmac("sha256", this.secret).update(v).digest("hex").slice(0, n);
  }

  private phone(v: string): string {
    const digits = BigInt(`0x${this.h(v.replace(/\D/g, ""), 12)}`).toString().padStart(10, "0").slice(0, 10);
    return `+99${digits}`;
  }

  private email(v: string): string {
    return `u${this.h(v.toLowerCase(), 8)}@example.invalid`;
  }

  /** Reemplaza teléfonos y mails dentro de cualquier texto (también ids como "whatsapp:+54911…"). */
  private inline(s: string): string {
    return s.replace(EMAIL, (m) => this.email(m)).replace(PHONE, (m) => this.phone(m));
  }

  private value(key: string, v: unknown): unknown {
    if (typeof v === "string") {
      if (CONTACT_KEYS.has(key)) return this.inline(v);
      if (SENSITIVE_KEYS.has(key)) {
        if (key === "name" || key === "displayName" || key === "alias" || key === "legalName") return `Persona ${this.h(v, 4)}`;
        if (key === "taxId") return "00000000000";
        return v.length ? "[texto anonimizado]" : v;
      }
      return this.inline(v);
    }
    if (Array.isArray(v)) return v.map((x) => this.value(key, x));
    if (v && typeof v === "object" && !(v instanceof Date)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, this.value(k, x)]));
    }
    return v;
  }

  /** Documento serializado → documento anonimizado (undefined = no se copia). */
  scrub(collection: string, encoded: string): string | undefined {
    if (NEVER_TO_STAGING.has(collection)) return undefined;
    if (PUBLIC.has(collection)) return encoded;
    const doc = JSON.parse(encoded) as Record<string, unknown>;
    if (CURATED_ONLY[collection]?.(doc)) return encoded;
    // Las fechas vienen como {"$date": "..."}: se preservan porque no son claves sensibles.
    return JSON.stringify(this.value("", doc));
  }
}
