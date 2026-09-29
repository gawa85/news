/**
 * PUESTA EN MARCHA: los datos de la empresa que opera la plataforma y la lista de lo que falta
 * configurar antes de abrir al público.
 */
export interface PlatformProfile {
  legalName: string;
  /** CUIT (Argentina): 11 dígitos con verificador. */
  taxId: string;
  address: string;
  contactEmail: string;
  /** Registro Nacional de Bases de Datos (AAIP). */
  dataRegistryNumber?: string;
  /** Edad mínima para usar el servicio general. */
  minimumAge?: 13 | 16 | 18;
  updatedAt: Date;
  updatedBy: string;
}

export type SetupStatus = "ok" | "warn" | "todo" | "optional";

export interface SetupCheck {
  id: string;
  group: "empresa" | "legal" | "servidor" | "canales" | "cobros" | "operacion" | "contenido";
  title: string;
  status: SetupStatus;
  detail: string;
  /** Adónde ir a resolverlo (pantalla del backoffice) o qué variable de entorno falta. */
  action?: { label: string; href?: string; env?: string[] };
}

/**
 * Completa en un texto legal los datos de la empresa que están entre corchetes. Sólo los datos:
 * plazos, proveedores y cláusulas quedan para la revisión legal.
 */
export function fillLegalPlaceholders(text: string, p: Pick<PlatformProfile, "legalName" | "taxId" | "address" | "contactEmail" | "dataRegistryNumber" | "minimumAge">): string {
  let out = text
    .replaceAll("[RAZÓN SOCIAL]", p.legalName)
    .replaceAll("CUIT [●]", `CUIT ${formatCuit(p.taxId)}`)
    .replaceAll("domicilio en [●]", `domicilio en ${p.address}`)
    .replaceAll("domicilio [●]", `domicilio ${p.address}`)
    .replaceAll("[mail]", p.contactEmail);
  if (p.dataRegistryNumber) out = out.replaceAll("[número, pendiente]", p.dataRegistryNumber);
  if (p.minimumAge) out = out.replaceAll("[13/16/18]", String(p.minimumAge));
  return out;
}

/** Lo que sigue entre corchetes (sin contar los enlaces [texto](dirección) ni la nota "[corchetes]"). */
export function remainingPlaceholders(text: string): string[] {
  return [...text.matchAll(/\[([^\]\n]+)\](?!\()/g)].map((m) => m[0]).filter((m) => m !== "[corchetes]");
}

/** 20123456789 → 20-12345678-9 */
export function formatCuit(raw: string): string {
  const d = raw.replace(/\D/g, "");
  return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : raw.trim();
}

/** Qué está configurado de verdad (lo arma la composición según el entorno; la aplicación no lee variables). */
export interface SetupFacts {
  environment: { name: string; production: boolean; problems: string[] };
  publicBaseUrl: string;
  mail: "real" | "test";
  whatsapp: { configured: boolean; publicNumber: boolean };
  telegram: { configured: boolean; botUsername: boolean };
  payments: "real" | "test";
  invoicing: "real" | "test" | "none";
  backups: boolean;
}
