import { AccessDeniedError, NotFoundError, ValidationError } from "../../domain/errors";
import { LEGAL_DOC_IDS, type ConsentRecord, type LegalDocId, type LegalDocument, type ResponseContent, type User } from "../../domain/model";
import { assessDefamationRisk } from "../../domain/rules/defamation";
import type { IAuthorizationService, IClock, IConsentRepository, IDomainEvents, ILegalDocumentRepository, IReviewModerator, IUserRepository, ModerationVerdict } from "../../domain/ports";

/** Lo que se publica de una versión: sin quién la cargó (interno). */
export type PublicLegalDocument = Omit<LegalDocument, "publishedBy">;
const publicDoc = ({ publishedBy: _by, ...d }: LegalDocument): PublicLegalDocument => d;
const isDocId = (id: string): id is LegalDocId => (LEGAL_DOC_IDS as string[]).includes(id);

/**
 * TÉRMINOS Y PRIVACIDAD versionados.
 * REGLAS:
 *  - Vale la versión más nueva ya publicada de cada documento; las anteriores se siguen pudiendo
 *    leer (cada aceptación dice qué versión se aceptó).
 *  - Se guarda quién aceptó qué versión, cuándo y cómo (clic en la web, aviso en el chat, API).
 *  - Un cambio material pide aceptar de nuevo; en el chat se muestra el aviso con los links
 *    y seguir usando el servicio queda registrado como aceptación (método "chat_notice").
 *  - Las aceptaciones se conservan como prueba (no tienen más datos que el id de la cuenta).
 */
export class LegalService {
  constructor(
    private readonly docs: ILegalDocumentRepository,
    private readonly consents: IConsentRepository,
    private readonly clock: IClock,
    private readonly publicBaseUrl: string,
  ) {}

  /** Versiones vigentes (sin el texto completo). */
  async current(): Promise<PublicLegalDocument[]> {
    const out: PublicLegalDocument[] = [];
    for (const id of LEGAL_DOC_IDS) {
      const d = await this.latest(id);
      if (d) out.push(this.summary(d));
    }
    return out;
  }

  /** Un documento completo: la versión vigente o una anterior. */
  async document(docId: string, version?: string): Promise<PublicLegalDocument> {
    const versions = isDocId(docId) ? await this.published(docId) : [];
    const d = version ? versions.find((v) => v.version === version) : versions[0];
    if (!d) throw new NotFoundError("No existe ese documento.");
    return { ...publicDoc(d), url: this.absolute(d.url) };
  }

  /** Historial de versiones publicadas (sin el texto). */
  async versions(docId: string): Promise<PublicLegalDocument[]> {
    if (!isDocId(docId)) throw new NotFoundError("No existe ese documento.");
    return (await this.published(docId)).map((d) => this.summary(d));
  }

  async pendingFor(userId: string): Promise<PublicLegalDocument[]> {
    const mine = await this.consents.findByUser(userId);
    return (await this.current()).filter((d) => {
      const accepted = mine.filter((c) => c.docId === d.id);
      if (accepted.some((c) => c.version === d.version)) return false;
      return d.material || accepted.length === 0;
    });
  }

  async accept(input: { userId: string; docId: LegalDocId; version: string; method: ConsentRecord["method"]; channel: string }): Promise<ConsentRecord> {
    const doc = isDocId(input.docId) ? await this.latest(input.docId) : undefined;
    if (!doc) throw new NotFoundError("No existe ese documento.");
    if (doc.version !== input.version) throw new ValidationError(`La versión vigente es ${doc.version}.`);
    const c: ConsentRecord = { id: `${input.userId}|${doc.id}|${doc.version}`, userId: input.userId, docId: doc.id, version: doc.version, method: input.method, channel: input.channel, at: this.clock.now() };
    await this.consents.save(c);
    return c;
  }

  /** Chat: agrega el aviso legal a la respuesta si falta aceptar algo, y lo registra. */
  async withNotice(r: ResponseContent, user: User, channel: string): Promise<ResponseContent> {
    const pending = await this.pendingFor(user.id);
    if (!pending.length) return r;
    for (const d of pending) await this.accept({ userId: user.id, docId: d.id, version: d.version, method: "chat_notice", channel });
    const notice = `Al usar Sin Humo aceptás ${pending.map((d) => `${d.title} (${d.url})`).join(" y ")}. Para dejar de usarlo y borrar tus datos, escribí /soporte.`;
    return { ...r, footer: [r.footer, notice].filter(Boolean).join(" ") };
  }

  private published(id: LegalDocId): Promise<LegalDocument[]> {
    return this.docs.findVersions(id);
  }

  private async latest(id: LegalDocId): Promise<LegalDocument | undefined> {
    return (await this.published(id))[0];
  }

  private summary(d: LegalDocument): PublicLegalDocument {
    const { body: _body, ...rest } = publicDoc(d);
    return { ...rest, url: this.absolute(d.url) };
  }

  private absolute(url: string): string {
    return url.startsWith("http") ? url : `${this.publicBaseUrl}${url}`;
  }
}

/**
 * PUBLICAR UNA VERSIÓN NUEVA de términos o privacidad (permiso `legal:publish`).
 * REGLAS:
 *  - Cada publicación es una versión nueva (fecha del día; si ya hay una ese día, con sufijo):
 *    nunca se reescribe una versión que alguien pudo haber aceptado.
 *  - "Cambio importante" (material) hace que todas las personas vuelvan a aceptar.
 *  - Mientras sea borrador, se muestra el aviso de borrador. Publicar sin ese aviso es decir que
 *    el texto ya lo revisó un/a abogado/a.
 */
export class LegalPublisher {
  constructor(
    private readonly docs: ILegalDocumentRepository,
    private readonly users: IUserRepository,
    private readonly authz: IAuthorizationService,
    private readonly events: IDomainEvents,
    private readonly clock: IClock,
  ) {}

  async publish(actorId: string, docId: string, input: { title: string; summary: string; body: string; material: boolean; draft: boolean }): Promise<PublicLegalDocument> {
    const u = await this.users.findById(actorId);
    if (!u || !(await this.authz.permissionsOf(u)).has("legal:publish")) throw new AccessDeniedError("No tenés permiso para publicar documentos legales.", "no_permission");
    if (!isDocId(docId)) throw new NotFoundError("No existe ese documento.");
    const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
    const title = text(input.title, 120);
    const summary = text(input.summary, 400);
    const body = typeof input.body === "string" ? input.body.replace(/\r\n/g, "\n").trim() : "";
    if (!title || !summary) throw new ValidationError("Faltan el título o el resumen.");
    if (body.length < 200) throw new ValidationError("El texto completo es demasiado corto.");
    if (body.length > 200_000) throw new ValidationError("El texto completo es demasiado largo.");
    const versions = await this.docs.findVersions(docId);
    const previous = versions[0];
    const now = this.clock.now();
    const day = now.toISOString().slice(0, 10);
    let version = day;
    for (let n = 2; versions.some((v) => v.version === version); n++) version = `${day}-${n}`;
    // Siempre después de la anterior (aunque esa tuviera fecha adelantada): la vigente es la última.
    const publishedAt = previous && previous.publishedAt >= now ? new Date(previous.publishedAt.getTime() + 1) : now;
    const doc: LegalDocument = {
      id: docId, title, summary, body, version, publishedAt, material: input.material === true, draft: input.draft === true,
      url: previous?.url ?? `/legal/${docId === "terms" ? "terminos" : "privacidad"}`, publishedBy: u.id,
    };
    await this.docs.save(doc);
    await this.events.emit("legal.published", { userId: u.id }, { docId, version, material: doc.material, draft: doc.draft, previous: previous?.version ?? null }, { type: "legal_document", id: `${docId}@${version}` });
    return publicDoc(doc);
  }
}

/**
 * Carga inicial de los documentos (idempotente): si un documento no tiene ninguna versión, se
 * guarda la del código. Si esa versión ya está pero sin texto, se le agrega el texto.
 */
export async function seedLegal(repo: ILegalDocumentRepository, defaults: LegalDocument[], texts: Partial<Record<LegalDocId, string>> = {}): Promise<void> {
  for (const d of defaults) {
    const versions = await repo.findVersions(d.id);
    const same = versions.find((v) => v.version === d.version);
    const body = texts[d.id];
    if (!versions.length) await repo.save({ ...d, body, publishedBy: "sistema" });
    else if (same && !same.body && body) await repo.save({ ...same, body });
  }
}

/**
 * Moderación con control de RIESGO DE DIFAMACIÓN: si un texto atribuye delitos, mentiras
 * deliberadas o motivaciones ocultas a un medio (o a sus dueños) identificable, no se
 * publica automáticamente: queda para revisión humana, con el motivo y cómo reescribirlo.
 */
export class DefamationAwareModerator implements IReviewModerator {
  constructor(
    private readonly inner: IReviewModerator,
    private readonly namedEntities: () => Promise<string[]>,
  ) {}

  async moderate(text: string): Promise<{ verdict: ModerationVerdict; reason?: string }> {
    const base = await this.inner.moderate(text);
    if (base.verdict === "reject") return base;
    const risk = assessDefamationRisk(text, await this.namedEntities());
    if (risk.level === "high") {
      return { verdict: "review", reason: `riesgo de difamación: ${risk.reasons.join(" ")} Sugerencia: ${risk.suggestions[0]}` };
    }
    return base;
  }
}
