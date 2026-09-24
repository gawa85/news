import { createHash } from "node:crypto";
import { AccessDeniedError, ConflictError, NotFoundError, ValidationError } from "../../domain/errors";
import type { DomainEvent, EvidenceItem, OfficialDocument, User, VerdictStatus, VerificationTask } from "../../domain/model";
import type {
  IAuthorizationService,
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
  ) {}

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
    if (!/^https?:\/\/\S+$/.test(doc.url)) throw new ValidationError("El documento necesita la URL oficial de donde se obtuvo.");
    const saved: OfficialDocument = { ...doc, id: this.ids.next("doc"), uploadedBy: actor.id };
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
