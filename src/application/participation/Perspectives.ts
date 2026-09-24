import { AccessDeniedError, ConflictError, NotFoundError, ValidationError } from "../../domain/errors";
import type { Perspective, PerspectiveKind, PerspectiveTarget, User } from "../../domain/model";
import type {
  IAuthorizationService,
  IClock,
  IDomainEvents,
  IPerspectiveRepository,
  IReviewModerator,
  IUserRepository,
  IVerificationTaskRepository,
} from "../../domain/ports";

/** Puntaje de utilidad (límite inferior de Wilson): no premia a lo que tiene 1 voto positivo. */
export function helpfulnessScore(helpful: number, notHelpful: number): number {
  const n = helpful + notHelpful;
  if (n === 0) return 0;
  const z = 1.96;
  const p = helpful / n;
  return (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / (1 + (z * z) / n);
}

/**
 * OTRA MIRADA: posiciones distintas sobre un análisis, una narrativa, la credibilidad
 * de un medio o un tema. La plataforma no se presenta como dueña de la verdad.
 *
 * REGLAS:
 *  - Se clasifica como los desacuerdos:
 *      sobre HECHOS → exige al menos una fuente;
 *      sobre INTERPRETACIÓN → exige argumento (80+ caracteres);
 *      sobre VALORES → puede ser opinión, y se muestra como tal.
 *  - Una por autor y objeto (se edita). Pasa moderación.
 *  - Presentarse como un medio exige ser su representante acreditado.
 *  - Si cuestiona un HECHO del análisis de la plataforma, va a la mesa de verificación
 *    (y si tiene razón, termina en fe de erratas).
 *  - Votos "me sirvió / no me sirvió": uno por persona; no se vota lo propio.
 */
export class PerspectiveService {
  constructor(
    private readonly perspectives: IPerspectiveRepository,
    private readonly tasks: IVerificationTaskRepository,
    private readonly users: IUserRepository,
    private readonly authz: IAuthorizationService,
    private readonly moderator: IReviewModerator,
    private readonly events: IDomainEvents,
    private readonly clock: IClock,
  ) {}

  async publish(input: {
    actorId: string;
    target: PerspectiveTarget;
    kind: PerspectiveKind;
    text: string;
    sources?: { label: string; url: string }[];
    authorAs?: Perspective["authorAs"];
    challengesPlatform?: boolean;
  }): Promise<Perspective> {
    const actor = await this.user(input.actorId);
    if (!(await this.authz.permissionsOf(actor)).has("perspectives:write") || !actor.channels.some((c) => c.verified)) {
      throw new AccessDeniedError("Para publicar necesitás una cuenta con un canal verificado.", "no_permission");
    }
    const text = input.text.trim();
    const sources = (input.sources ?? []).filter((s) => /^https?:\/\/\S+$/.test(s.url)).slice(0, 10);
    if (input.kind === "fact" && sources.length === 0) throw new ValidationError("Una mirada sobre HECHOS necesita al menos una fuente.");
    if (input.kind === "interpretation" && text.length < 80) throw new ValidationError("Argumentá tu interpretación (al menos 80 caracteres).");
    if (text.length < 20 || text.length > 3000) throw new ValidationError("El texto tiene que tener entre 20 y 3000 caracteres.");
    const authorAs = input.authorAs ?? "person";
    if (authorAs === "outlet" && !(actor.representsOutletIds ?? []).length) throw new AccessDeniedError("Para hablar en nombre de un medio tenés que ser su representante acreditado.", "no_permission");
    if (authorAs === "organization" && !actor.organizationId) throw new ValidationError("No pertenecés a una organización.");

    const verdict = await this.moderator.moderate(text);
    const id = `pv:${input.target.type}:${input.target.id}:${actor.id}`;
    const existing = await this.perspectives.findById(id);
    const now = this.clock.now();
    const p: Perspective = {
      id, target: input.target, authorId: actor.id, authorAs, kind: input.kind, text, sources,
      challengesPlatform: !!input.challengesPlatform,
      status: verdict.verdict === "approve" ? "published" : verdict.verdict === "reject" ? "rejected" : "pending_moderation",
      helpful: existing?.helpful ?? 0, notHelpful: existing?.notHelpful ?? 0,
      createdAt: existing?.createdAt ?? now, updatedAt: now,
    };
    await this.perspectives.save(p);

    if (p.status === "published") {
      await this.events.emit("perspective.published", { userId: actor.id, organizationId: actor.organizationId }, { kind: p.kind, target: p.target }, { type: "perspective", id: p.id });
      if (p.challengesPlatform && p.kind === "fact") await this.toVerification(p);
    }
    return p;
  }

  async vote(input: { actorId: string; perspectiveId: string; helpful: boolean }): Promise<Perspective> {
    const actor = await this.user(input.actorId);
    const p = await this.perspectives.findById(input.perspectiveId);
    if (!p || p.status !== "published") throw new NotFoundError("No existe esa mirada.");
    if (p.authorId === actor.id) throw new ConflictError("No podés votar tu propia mirada.");
    const prev = await this.perspectives.vote({ id: `${p.id}|${actor.id}`, perspectiveId: p.id, userId: actor.id, helpful: input.helpful, at: this.clock.now() });
    let { helpful, notHelpful } = p;
    if (prev) prev.helpful ? helpful-- : notHelpful--;
    input.helpful ? helpful++ : notHelpful++;
    const next = { ...p, helpful, notHelpful };
    await this.perspectives.save(next);
    return next;
  }

  /** Miradas publicadas, las más útiles primero, agrupadas por tipo. */
  async forTarget(target: PerspectiveTarget): Promise<Record<PerspectiveKind, Perspective[]>> {
    const list = (await this.perspectives.findByTarget(target))
      .filter((p) => p.status === "published")
      .sort((a, b) => helpfulnessScore(b.helpful, b.notHelpful) - helpfulnessScore(a.helpful, a.notHelpful));
    return { fact: list.filter((p) => p.kind === "fact"), interpretation: list.filter((p) => p.kind === "interpretation"), values: list.filter((p) => p.kind === "values") };
  }

  private async toVerification(p: Perspective): Promise<void> {
    try {
      await this.tasks.insert({
        id: `vt_pv_${p.id.replace(/[^\w]/g, "_")}`,
        topic: p.target.type === "topic" ? p.target.id : `${p.target.type}:${p.target.id}`,
        question: `Un usuario cuestiona el análisis de la plataforma: "${p.text.slice(0, 300)}"`,
        claimIds: [], outletIds: [], figures: [], priority: 5, status: "open",
        evidence: p.sources.map((s) => ({ source: `Aportada por usuario: ${s.label}`, description: s.label, url: s.url, addedBy: p.authorId, addedAt: this.clock.now() })),
        createdAt: this.clock.now(),
      });
    } catch (err) {
      if (!(err instanceof ConflictError)) throw err;
    }
  }

  private async user(id: string): Promise<User> {
    const u = await this.users.findById(id);
    if (!u || u.status !== "active") throw new NotFoundError("Usuario inexistente.");
    return u;
  }
}
