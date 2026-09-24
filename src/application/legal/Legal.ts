import { NotFoundError, ValidationError } from "../../domain/errors";
import type { ConsentRecord, LegalDocId, LegalDocument, ResponseContent, User } from "../../domain/model";
import { assessDefamationRisk } from "../../domain/rules/defamation";
import type { IClock, IConsentRepository, IReviewModerator, ModerationVerdict } from "../../domain/ports";

/**
 * TÉRMINOS Y PRIVACIDAD versionados.
 * REGLAS:
 *  - Se guarda quién aceptó qué versión, cuándo y cómo (clic en la web, aviso en el chat, API).
 *  - Un cambio material pide aceptar de nuevo; en el chat se muestra el aviso con los links
 *    y seguir usando el servicio queda registrado como aceptación (método "chat_notice").
 *  - Las aceptaciones se conservan como prueba (no tienen más datos que el id de la cuenta).
 */
export class LegalService {
  constructor(
    private readonly docs: LegalDocument[],
    private readonly consents: IConsentRepository,
    private readonly clock: IClock,
    private readonly publicBaseUrl: string,
  ) {}

  current(): LegalDocument[] {
    return this.docs.map((d) => ({ ...d, url: d.url.startsWith("http") ? d.url : `${this.publicBaseUrl}${d.url}` }));
  }

  async pendingFor(userId: string): Promise<LegalDocument[]> {
    const mine = await this.consents.findByUser(userId);
    return this.current().filter((d) => {
      const accepted = mine.filter((c) => c.docId === d.id);
      if (accepted.some((c) => c.version === d.version)) return false;
      return d.material || accepted.length === 0;
    });
  }

  async accept(input: { userId: string; docId: LegalDocId; version: string; method: ConsentRecord["method"]; channel: string }): Promise<ConsentRecord> {
    const doc = this.docs.find((d) => d.id === input.docId);
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
