import { createHash } from "node:crypto";
import { AccessDeniedError, ConflictError, NotFoundError, ValidationError } from "../../domain/errors";
import type { DomainEvent, EvidenceItem, OfficialDocument, User, VerdictStatus, VerificationTask } from "../../domain/model";
import { figuresOf } from "../../domain/rules/figures";
import type {
  IArticleReader,
  IAuthorizationService,
  IClaimReader,
  IClock,
  IDomainEvents,
  IEventBus,
  IIdGenerator,
  ILogger,
  IOfficialDocumentRepository,
  IPrimarySourceProvider,
  IUserRepository,
  IVerdictWriter,
  IVerificationTaskRepository,
} from "../../domain/ports";

interface DisputePayload {
  topic: string;
  description: string;
  positions: { outletId: string; claimText: string; claimId?: string }[];
}

/**
 * Convierte los DATOS EN DISPUTA de cada comparación en tareas de verificación.
 * Escucha el evento "comparison.completed"; la misma disputa no se carga dos veces.
 */
export class VerificationTaskGenerator {
  constructor(
    private readonly tasks: IVerificationTaskRepository,
    private readonly events: IDomainEvents,
    private readonly clock: IClock,
    private readonly logger: ILogger,
  ) {}

  attach(bus: IEventBus): void {
    bus.subscribe(async (e: DomainEvent) => {
      if (e.type !== "comparison.completed") return;
      for (const d of (e.data.factualDisputes as DisputePayload[] | undefined) ?? []) await this.fromDispute(d);
    });
  }

  async fromDispute(d: DisputePayload): Promise<VerificationTask | undefined> {
    const claimIds = d.positions.map((p) => p.claimId).filter((x): x is string => !!x);
    const outletIds = [...new Set(d.positions.map((p) => p.outletId))];
    const signature = createHash("sha256").update(`${d.topic}|${[...d.positions.map((p) => p.claimText)].sort().join("|")}`).digest("hex").slice(0, 24);
    const task: VerificationTask = {
      id: `vt_${signature}`,
      topic: d.topic,
      question: d.description,
      claimIds,
      outletIds,
      figures: [...new Set(d.positions.flatMap((p) => (p.claimText.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => Number(n.replace(",", ".")))))],
      priority: outletIds.length * 10 + claimIds.length,
      status: "open",
      evidence: [],
      createdAt: this.clock.now(),
    };
    try {
      await this.tasks.insert(task);
    } catch (err) {
      if (err instanceof ConflictError) return undefined;
      throw err;
    }
    await this.events.emit("verification.task_created", { userId: "sistema" }, { topic: task.topic, outlets: outletIds.length }, { type: "verification_task", id: task.id });
    this.logger.info("Nueva tarea de verificación", { id: task.id });
    return task;
  }
}

/**
 * MESA DE VERIFICACIÓN.
 *
 * REGLAS:
 *  - Trabaja quien tiene `verdicts:write`.
 *  - Nadie verifica afirmaciones de un medio al que representa (conflicto de interés).
 *  - Para resolver hace falta al menos UNA evidencia con link verificable, y una nota.
 *  - La resolución registra una verificación por afirmación: eso alimenta la
 *    "exactitud" de cada medio en el medidor de credibilidad.
 */
export class VerificationDesk {
  constructor(
    private readonly tasks: IVerificationTaskRepository,
    private readonly verdicts: IVerdictWriter,
    private readonly documents: IOfficialDocumentRepository,
    private readonly providers: IPrimarySourceProvider[],
    private readonly users: IUserRepository,
    private readonly authz: IAuthorizationService,
    private readonly events: IDomainEvents,
    private readonly ids: IIdGenerator,
    private readonly clock: IClock,
    private readonly logger: ILogger,
    /** Para armar tareas a partir de afirmaciones del catálogo (los datos repetidos del panorama). */
    private readonly catalog?: { claims: IClaimReader; articles: IArticleReader },
  ) {}

  /**
   * MANDAR A VERIFICAR afirmaciones que repiten varios medios (desde el panorama de credibilidad).
   * Si ya hay una tarea abierta con alguna de ellas, se usa esa (no se duplica el trabajo).
   * Con `take`, quien la pide la toma en el mismo paso.
   */
  async fromClaims(input: { actorId: string; claimIds: string[]; take?: boolean }): Promise<VerificationTask> {
    const actor = await this.checker(input.actorId);
    if (!this.catalog) throw new ValidationError("La verificación desde el panorama no está configurada.");
    const ids = [...new Set(Array.isArray(input.claimIds) ? input.claimIds.filter((x): x is string => typeof x === "string") : [])];
    if (ids.length === 0 || ids.length > 50) throw new ValidationError("Elegí entre 1 y 50 afirmaciones.");
    const claims = (await this.catalog.claims.findByIds(ids)).filter((c) => c.kind === "fact");
    if (claims.length !== ids.length) throw new NotFoundError("Alguna de esas afirmaciones no existe (o no es un dato).");

    const open = [...(await this.tasks.findByStatus("assigned", 500)), ...(await this.tasks.findByStatus("open", 500))];
    let task = open.find((t) => t.claimIds.some((id) => ids.includes(id)));
    if (!task) {
      const articles = await Promise.all([...new Set(claims.map((c) => c.articleId))].map((id) => this.catalog!.articles.findById(id)));
      const topics = new Map<string, number>();
      for (const a of articles) if (a) topics.set(a.topic, (topics.get(a.topic) ?? 0) + 1);
      const topic = [...topics].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "otros";
      const shortest = claims.reduce((a, b) => (b.text.length < a.text.length ? b : a));
      const outletIds = [...new Set(claims.map((c) => c.outletId))];
      const signature = createHash("sha256").update([...ids].sort().join("|")).digest("hex").slice(0, 24);
      const fresh: VerificationTask = {
        id: `vt_${signature}`,
        topic,
        question: `¿Es cierto? «${shortest.text.replace(/\s+/g, " ").trim()}»`,
        claimIds: ids,
        outletIds,
        figures: [...new Set(claims.flatMap(figuresOf))],
        priority: outletIds.length * 10 + ids.length,
        status: "open",
        evidence: [],
        createdAt: this.clock.now(),
      };
      try {
        await this.tasks.insert(fresh);
        await this.events.emit("verification.task_created", { userId: actor.id }, { topic, outlets: outletIds.length, from: "panorama" }, { type: "verification_task", id: fresh.id });
        task = fresh;
      } catch (err) {
        if (!(err instanceof ConflictError)) throw err;
        task = await this.task(fresh.id);
      }
    }
    if (input.take && task.status === "open") return this.take(actor.id, task.id);
    return task;
  }

  async queue(actorId: string, limit = 50): Promise<VerificationTask[]> {
    await this.checker(actorId);
    return [...(await this.tasks.findByStatus("open", limit)), ...(await this.tasks.findByStatus("assigned", limit))];
  }

  async take(actorId: string, taskId: string): Promise<VerificationTask> {
    const actor = await this.checker(actorId);
    const task = await this.task(taskId);
    this.assertNoConflict(actor, task);
    if (task.status === "assigned" && task.assigneeId !== actor.id) throw new ConflictError("La tarea ya la tomó otra persona.");
    if (task.status === "resolved" || task.status === "discarded") throw new ConflictError("La tarea ya está cerrada.");
    const next: VerificationTask = { ...task, status: "assigned", assigneeId: actor.id };
    await this.tasks.save(next);
    return next;
  }

  /** Consulta las fuentes primarias y agrega lo que encuentren como evidencia sugerida. */
  async suggestEvidence(actorId: string, taskId: string): Promise<VerificationTask> {
    await this.checker(actorId);
    const task = await this.task(taskId);
    const found: EvidenceItem[] = [];
    for (const p of this.providers) {
      try {
        for (const e of await p.lookup(task)) found.push({ ...e, addedBy: "sistema", addedAt: this.clock.now() });
      } catch (err) {
        this.logger.warn("Falló una fuente primaria", { provider: p.id, error: String(err) });
      }
    }
    const known = new Set(task.evidence.map((e) => `${e.source}|${e.url}|${e.value}`));
    const next = { ...task, evidence: [...task.evidence, ...found.filter((e) => !known.has(`${e.source}|${e.url}|${e.value}`))] };
    await this.tasks.save(next);
    return next;
  }

  async addEvidence(actorId: string, taskId: string, item: { source: string; description: string; url?: string; value?: number; date?: string }): Promise<VerificationTask> {
    const actor = await this.checker(actorId);
    const task = await this.task(taskId);
    if (item.url && !/^https?:\/\/\S+$/.test(item.url)) throw new ValidationError("Link de evidencia inválido.");
    const next = { ...task, evidence: [...task.evidence, { ...item, addedBy: actor.id, addedAt: this.clock.now() }] };
    await this.tasks.save(next);
    return next;
  }

  async resolve(input: { actorId: string; taskId: string; verdicts: Record<string, VerdictStatus>; note: string }): Promise<VerificationTask> {
    const actor = await this.checker(input.actorId);
    const task = await this.task(input.taskId);
    this.assertNoConflict(actor, task);
    if (task.status !== "assigned" || task.assigneeId !== actor.id) throw new ConflictError("Primero tomá la tarea.");
    if (!task.evidence.some((e) => e.url)) throw new ValidationError("Para resolver hace falta al menos una evidencia con link.");
    if (input.note.trim().length < 20) throw new ValidationError("Explicá la resolución (al menos 20 caracteres).");
    const unknown = Object.keys(input.verdicts).filter((id) => !task.claimIds.includes(id));
    if (unknown.length || !Object.keys(input.verdicts).length) throw new ValidationError("Indicá una verificación por cada afirmación de la tarea.");

    const now = this.clock.now();
    const evidenceUrl = task.evidence.find((e) => e.url)!.url;
    for (const [claimId, status] of Object.entries(input.verdicts)) await this.verdicts.save({ claimId, status, checkedAt: now, evidenceUrl });
    const done: VerificationTask = { ...task, status: "resolved", verdicts: input.verdicts, resolutionNote: input.note.trim(), resolvedAt: now };
    await this.tasks.save(done);
    await this.events.emit("verification.resolved", { userId: actor.id }, { topic: task.topic, verdicts: input.verdicts, evidenceUrl }, { type: "verification_task", id: task.id });
    return done;
  }

  async discard(input: { actorId: string; taskId: string; note: string }): Promise<VerificationTask> {
    const actor = await this.checker(input.actorId);
    const task = await this.task(input.taskId);
    if (input.note.trim().length < 20) throw new ValidationError("Explicá por qué se descarta (p. ej. hablan de períodos distintos).");
    const done: VerificationTask = { ...task, status: "discarded", resolutionNote: input.note.trim(), resolvedAt: this.clock.now(), assigneeId: task.assigneeId ?? actor.id };
    await this.tasks.save(done);
    return done;
  }

  /** Cargar un documento oficial (resolución, informe) para que la búsqueda lo encuentre. */
  async uploadDocument(actorId: string, doc: Omit<OfficialDocument, "id" | "uploadedBy">): Promise<OfficialDocument> {
    const actor = await this.checker(actorId);
    const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
    const url = text(doc.url, 2_000);
    if (!/^https?:\/\/\S+$/.test(url)) throw new ValidationError("El documento necesita la URL oficial de donde se obtuvo.");
    const title = text(doc.title, 300);
    const issuer = text(doc.issuer, 200);
    const body = text(doc.text, 500_000);
    if (!title || !issuer || !body) throw new ValidationError("Faltan el título, quién lo emitió o el texto del documento.");
    if (!(doc.publishedAt instanceof Date) || Number.isNaN(doc.publishedAt.getTime())) throw new ValidationError("Falta la fecha de publicación.");
    const topics = Array.isArray(doc.topics) ? [...new Set(doc.topics.filter((t): t is string => typeof t === "string").map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20) : [];
    // Campo por campo: el id y quién lo subió los pone el sistema, nunca el pedido.
    const saved: OfficialDocument = { id: this.ids.next("doc"), title, issuer, url, publishedAt: doc.publishedAt, text: body, topics, uploadedBy: actor.id };
    await this.documents.save(saved);
    return saved;
  }

  private async checker(actorId: string): Promise<User> {
    const actor = await this.users.findById(actorId);
    if (!actor || !(await this.authz.permissionsOf(actor)).has("verdicts:write")) throw new AccessDeniedError("No sos parte del equipo de verificación.", "no_permission");
    return actor;
  }

  private assertNoConflict(actor: User, task: VerificationTask): void {
    const conflict = (actor.representsOutletIds ?? []).filter((o) => task.outletIds.includes(o));
    if (conflict.length) throw new AccessDeniedError("Representás a un medio involucrado: esta tarea la tiene que hacer otra persona.", "no_permission");
  }

  private async task(id: string): Promise<VerificationTask> {
    const t = await this.tasks.findById(id);
    if (!t) throw new NotFoundError("No existe esa tarea.");
    return t;
  }
}
