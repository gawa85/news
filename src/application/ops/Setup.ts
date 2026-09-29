import { AccessDeniedError, ValidationError } from "../../domain/errors";
import { fillLegalPlaceholders, onSale, remainingPlaceholders, LEGAL_DOC_IDS, type PlatformProfile, type SetupCheck, type SetupFacts, type User } from "../../domain/model";
import type { BackupManifest, IAuthorizationService, IClock, IDomainEvents, IPlanRepository, IPlatformProfileRepository, IRoleRepository, IUserDirectory, IUserRepository } from "../../domain/ports";
import { isValidCuit } from "../../domain/rules/invoiceRules";
import type { LegalPublisher, LegalService } from "../legal/Legal";

const DAY = 86_400_000;

/** Cuentas del contenido (puerto chico: la composición sabe de dónde salen). */
export interface SetupCounts {
  outlets(): Promise<number>;
  activeFeeds(): Promise<number>;
  activeTopics(): Promise<number>;
}

/**
 * PUESTA EN MARCHA (permiso `users:manage_all`): los datos de la empresa y la lista de lo que
 * falta para abrir al público, con adónde ir a resolver cada cosa.
 * REGLAS:
 *  - La lista sale del estado real (configuración, base, copias): no se marca a mano.
 *  - "Completar los legales" sólo reemplaza los datos de la empresa y publica una versión NUEVA
 *    como borrador: plazos, proveedores y cláusulas los decide la revisión legal.
 */
export class SetupService {
  constructor(
    private readonly profiles: IPlatformProfileRepository,
    private readonly users: IUserRepository & IUserDirectory,
    private readonly roles: IRoleRepository,
    private readonly authz: IAuthorizationService,
    private readonly events: IDomainEvents,
    private readonly clock: IClock,
    private readonly legal: LegalService,
    private readonly publisher: LegalPublisher,
    private readonly plans: IPlanRepository,
    private readonly counts: SetupCounts,
    private readonly facts: SetupFacts,
    private readonly backups?: { list(): Promise<BackupManifest[]> },
  ) {}

  async profile(actorId: string): Promise<PlatformProfile | undefined> {
    await this.admin(actorId);
    return this.profiles.get();
  }

  async saveProfile(actorId: string, input: Partial<Omit<PlatformProfile, "updatedAt" | "updatedBy">>): Promise<PlatformProfile> {
    const actor = await this.admin(actorId);
    const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
    const legalName = text(input.legalName, 200);
    const taxId = text(input.taxId, 20).replace(/\D/g, "");
    const address = text(input.address, 300);
    const contactEmail = text(input.contactEmail, 200).toLowerCase();
    if (!legalName || !address) throw new ValidationError("Faltan la razón social o el domicilio.");
    if (!isValidCuit(taxId)) throw new ValidationError("El CUIT no es válido (revisá el dígito verificador).");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw new ValidationError("El mail de contacto no es válido.");
    const minimumAge = input.minimumAge === 13 || input.minimumAge === 16 || input.minimumAge === 18 ? input.minimumAge : undefined;
    const p: PlatformProfile = {
      legalName, taxId, address, contactEmail, dataRegistryNumber: text(input.dataRegistryNumber, 60) || undefined, minimumAge,
      updatedAt: this.clock.now(), updatedBy: actor.id,
    };
    await this.profiles.save(p);
    await this.events.emit("platform.profile_changed", { userId: actor.id }, { legalName });
    return p;
  }

  /** Publica versiones borrador de términos y privacidad con los datos de la empresa completos. */
  async fillLegal(actorId: string): Promise<{ published: { docId: string; version: string }[]; remaining: Record<string, string[]> }> {
    await this.admin(actorId);
    const p = await this.profiles.get();
    if (!p) throw new ValidationError("Primero cargá los datos de la empresa.");
    const published: { docId: string; version: string }[] = [];
    const remaining: Record<string, string[]> = {};
    for (const id of LEGAL_DOC_IDS) {
      const doc = await this.legal.document(id);
      if (!doc.body) continue;
      const body = fillLegalPlaceholders(doc.body, p);
      remaining[id] = remainingPlaceholders(body);
      if (body === doc.body) continue;
      const v = await this.publisher.publish(actorId, id, { title: doc.title, summary: doc.summary, body, material: false, draft: true });
      published.push({ docId: id, version: v.version });
    }
    return { published, remaining };
  }

  async checklist(actorId: string): Promise<SetupCheck[]> {
    await this.admin(actorId);
    const f = this.facts;
    const out: SetupCheck[] = [];
    const add = (c: SetupCheck) => out.push(c);

    // Empresa y legales
    const p = await this.profiles.get();
    add(p
      ? { id: "empresa", group: "empresa", title: "Datos de la empresa", status: "ok", detail: `${p.legalName}, CUIT ${p.taxId}.` }
      : { id: "empresa", group: "empresa", title: "Datos de la empresa", status: "todo", detail: "Razón social, CUIT, domicilio y mail de contacto: van en los términos, la privacidad y las facturas.", action: { label: "Cargarlos", href: "#empresa" } });
    for (const id of LEGAL_DOC_IDS) {
      const doc = await this.legal.document(id).catch(() => undefined);
      const title = id === "terms" ? "Términos y condiciones" : "Política de privacidad";
      if (!doc) {
        add({ id: `legal-${id}`, group: "legal", title, status: "todo", detail: "No hay ninguna versión publicada.", action: { label: "Publicar", href: "/admin/legal" } });
        continue;
      }
      const left = doc.body ? remainingPlaceholders(doc.body) : [];
      const status = !doc.draft && !left.length ? "ok" : doc.draft ? "todo" : "warn";
      const detail = [
        doc.draft ? "Es un borrador: falta la revisión legal." : "Publicada como definitiva.",
        left.length ? `Quedan ${left.length} dato(s) entre corchetes (${[...new Set(left)].slice(0, 4).join(", ")}${left.length > 4 ? "…" : ""}).` : "",
        !doc.body ? "No tiene el texto completo cargado." : "",
      ].filter(Boolean).join(" ");
      add({ id: `legal-${id}`, group: "legal", title, status, detail, action: { label: "Revisar", href: "/admin/legal" } });
    }

    // Servidor
    const url = safeUrl(f.publicBaseUrl);
    const https = url?.protocol === "https:" && !/^(localhost|127\.|10\.|192\.168\.)/.test(url.hostname);
    add({ id: "url", group: "servidor", title: "Dirección pública con HTTPS", status: https ? "ok" : "todo", detail: https ? f.publicBaseUrl : `Hoy es ${f.publicBaseUrl}. Hace falta un dominio propio con HTTPS.`, action: https ? undefined : { label: "Configurar", env: ["PUBLIC_BASE_URL"] } });
    add(f.environment.production
      ? { id: "ambiente", group: "servidor", title: "Ambiente de producción", status: f.environment.problems.length ? "todo" : "ok", detail: f.environment.problems.length ? f.environment.problems.join(" ") : "Sin problemas de configuración." }
      : { id: "ambiente", group: "servidor", title: "Ambiente de producción", status: "warn", detail: `Estás en ${f.environment.name}: los mensajes van sólo a la lista de prueba y hay datos de ejemplo.`, action: { label: "Configurar", env: ["APP_ENV"] } });

    // Canales
    add({ id: "mail", group: "canales", title: "Mail", status: f.mail === "real" ? "ok" : "todo", detail: f.mail === "real" ? "Los mails salen de verdad." : "Los mails no salen (modo de prueba). Sin mail no se puede entrar con enlace.", action: f.mail === "real" ? undefined : { label: "Configurar", env: ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "MAIL_FROM"] } });
    add(chatCheck("whatsapp", "WhatsApp", f.whatsapp.configured, f.whatsapp.publicNumber, ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"], "WHATSAPP_PUBLIC_NUMBER"));
    add(chatCheck("telegram", "Telegram", f.telegram.configured, f.telegram.botUsername, ["TELEGRAM_BOT_TOKEN", "TELEGRAM_SECRET_TOKEN"], "TELEGRAM_BOT_USERNAME"));

    // Cobros
    add({ id: "cobros", group: "cobros", title: "Cobros", status: f.payments === "real" ? "ok" : "todo", detail: f.payments === "real" ? "Conectado al proveedor de pagos." : "Los cobros son de prueba: nadie puede pagar un plan. Falta conectar un proveedor (por ejemplo, Mercado Pago)." });
    add({ id: "facturas", group: "cobros", title: "Factura electrónica", status: f.invoicing === "real" ? "ok" : "todo", detail: f.invoicing === "real" ? "Conectada a ARCA." : "Las facturas no se emiten de verdad. Falta conectar ARCA (certificado del CUIT de la empresa)." });
    const forSale = (await this.plans.findAll()).filter((x) => x.price && onSale(x));
    add({ id: "planes", group: "cobros", title: "Planes en venta", status: forSale.length ? "ok" : "todo", detail: forSale.length ? `${forSale.length} plan(es) pago(s) en venta.` : "No hay ningún plan pago en venta.", action: { label: "Planes", href: "/admin/planes" } });

    // Operación
    const backups = f.backups && this.backups ? await this.backups.list() : [];
    const last = backups[0];
    const recent = last && this.clock.now().getTime() - new Date(last.createdAt).getTime() < 2 * DAY;
    add(!f.backups
      ? { id: "copias", group: "operacion", title: "Copias de seguridad", status: "todo", detail: "No están configuradas: si se pierde el servidor, se pierde todo.", action: { label: "Configurar", env: ["BACKUP_DIR o BACKUP_S3_BUCKET", "BACKUP_PASSPHRASE"] } }
      : { id: "copias", group: "operacion", title: "Copias de seguridad", status: recent && last?.verification?.ok ? "ok" : "warn", detail: !last ? "Todavía no hay ninguna copia." : `Última: ${new Date(last.createdAt).toLocaleDateString("es-AR")}${last.verification?.ok ? ", verificada" : ", sin verificar"}.`, action: { label: "Copias", href: "/admin/copias" } });
    const adminRoles = (await this.roles.findAll()).filter((r) => r.permissions.includes("users:manage_all")).map((r) => r.id);
    const admins = (await this.users.findWithRoles(adminRoles, 100)).filter((u) => u.status === "active").length;
    add({ id: "equipo", group: "operacion", title: "Equipo de la plataforma", status: admins >= 2 ? "ok" : "warn", detail: admins >= 2 ? `${admins} cuentas administran la plataforma.` : "Una sola cuenta administra la plataforma: si pierde el acceso, nadie más puede.", action: { label: "Personas", href: "/admin/personas" } });

    // Contenido
    const [outlets, feeds, topics] = await Promise.all([this.counts.outlets(), this.counts.activeFeeds(), this.counts.activeTopics()]);
    add({ id: "catalogo", group: "contenido", title: "Catálogo de medios", status: outlets && feeds ? "ok" : "todo", detail: `${outlets} medio(s), ${feeds} feed(s) activo(s).${feeds ? "" : " Sin feeds no entran notas nuevas."}`, action: { label: "Medios", href: "/admin/medios" } });
    add({ id: "temas", group: "contenido", title: "Temas", status: topics ? "ok" : "todo", detail: `${topics} tema(s) activo(s).`, action: { label: "Temas", href: "/admin/temas" } });
    return out;
  }

  private async admin(actorId: string): Promise<User> {
    const u = await this.users.findById(actorId);
    if (!u || !(await this.authz.permissionsOf(u)).has("users:manage_all")) throw new AccessDeniedError("Sólo la administración de la plataforma.", "no_permission");
    return u;
  }
}

function chatCheck(id: string, name: string, configured: boolean, button: boolean, env: string[], buttonEnv: string): SetupCheck {
  if (!configured) return { id, group: "canales", title: name, status: "optional", detail: `No está conectado. Es opcional, pero es por donde más se usa Sin Humo.`, action: { label: "Configurar", env } };
  if (!button) return { id, group: "canales", title: name, status: "warn", detail: `Conectado, pero la web no puede ofrecer el botón para vincularlo.`, action: { label: "Configurar", env: [buttonEnv] } };
  return { id, group: "canales", title: name, status: "ok", detail: "Conectado, con el botón para vincularlo desde la web." };
}

function safeUrl(u: string): URL | undefined {
  try {
    return new URL(u);
  } catch {
    return undefined;
  }
}
