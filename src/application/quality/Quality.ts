import { AccessDeniedError, ConflictError, NotFoundError, ValidationError } from "../../domain/errors";
import type {
  AnalysisFeedback,
  EvaluationMetrics,
  EvaluationRun,
  FeedbackReason,
  LabeledExample,
  ModelVersion,
  SmokeType,
  User,
} from "../../domain/model";
import type {
  IAuthorizationService,
  IClock,
  IContentAnalysisRepository,
  IDomainEvents,
  IIdGenerator,
  IParameterStore,
  IQualityRepository,
  ISmokeDetector,
  IUserRepository,
} from "../../domain/ports";

/** Desde qué índice se considera que un texto "tiene humo". */
export const SMOKE_THRESHOLD = 30;

/**
 * CALIDAD MEDIBLE DEL DETECTOR.
 *
 * REGLAS:
 *  - Los ejemplos etiquetados los carga quien tiene `quality:manage`.
 *  - Sólo cuentan los ejemplos REVISADOS (los que llegan de "no me sirvió" esperan revisión).
 *  - Una versión nueva sólo se ACTIVA si en la evaluación no empeora más de una tolerancia
 *    (precisión F1 y exactitud) respecto de la versión activa: barrera contra regresiones.
 */
export class QualityService {
  constructor(
    private readonly repo: IQualityRepository,
    private readonly users: IUserRepository,
    private readonly authz: IAuthorizationService,
    private readonly events: IDomainEvents,
    private readonly ids: IIdGenerator,
    private readonly clock: IClock,
    private readonly tolerance = 0.02,
    /** Umbral de humo y tolerancia editables (parámetros de negocio). */
    private readonly params?: IParameterStore,
  ) {}

  async addExample(input: { actorId: string; text: string; isSmoke: boolean; types: SmokeType[]; note?: string }): Promise<LabeledExample> {
    const actor = await this.manager(input.actorId);
    if (input.text.trim().length < 10) throw new ValidationError("El ejemplo es demasiado corto.");
    if (!input.isSmoke && input.types.length) throw new ValidationError("Un texto sin humo no puede tener tipos de humo.");
    const e: LabeledExample = {
      id: this.ids.next("example"), text: input.text.trim(), expected: { isSmoke: input.isSmoke, types: [...new Set(input.types)] },
      source: "curated", reviewed: true, addedBy: actor.id, addedAt: this.clock.now(), note: input.note,
    };
    await this.repo.saveExample(e);
    return e;
  }

  /** Revisar un ejemplo que llegó por "no me sirvió": se confirma la etiqueta correcta. */
  async reviewExample(input: { actorId: string; exampleId: string; isSmoke: boolean; types: SmokeType[] }): Promise<LabeledExample> {
    await this.manager(input.actorId);
    const e = (await this.repo.findExamples()).find((x) => x.id === input.exampleId);
    if (!e) throw new NotFoundError("No existe ese ejemplo.");
    const next = { ...e, expected: { isSmoke: input.isSmoke, types: input.types }, reviewed: true };
    await this.repo.saveExample(next);
    return next;
  }

  /** Corre el detector sobre los ejemplos revisados y guarda las métricas de esa versión. */
  async evaluate(input: { actorId: string; detector: ISmokeDetector }): Promise<EvaluationRun> {
    await this.manager(input.actorId);
    const { detector } = input;
    const examples = (await this.repo.findExamples()).filter((e) => e.reviewed);
    if (!examples.length) throw new ValidationError("No hay ejemplos revisados para evaluar.");
    const version = detector.version ?? "sin-version";
    const threshold = this.params ? await this.params.number("smoke.threshold") : SMOKE_THRESHOLD;
    const results = [];
    for (const e of examples) {
      const r = await detector.analyze(e.text);
      results.push({ e, got: { isSmoke: r.smokeIndex >= threshold, types: [...new Set(r.findings.map((f) => f.type))], smokeIndex: r.smokeIndex } });
    }
    const metrics = computeMetrics(results.map((x) => ({ expected: x.e.expected, got: x.got })));
    const run: EvaluationRun = {
      id: this.ids.next("evalrun"), modelVersion: version, at: this.clock.now(), metrics,
      failures: results.filter((x) => x.got.isSmoke !== x.e.expected.isSmoke).map((x) => ({ exampleId: x.e.id, expected: x.e.expected, got: x.got })),
    };
    await this.repo.saveRun(run);
    const existing = await this.repo.findVersion(version);
    await this.repo.saveVersion({
      ...(existing ?? { id: version, engine: version.startsWith("ia-") ? "llm" : "rules", description: version, status: "candidate", createdAt: this.clock.now() }),
      lastEvaluation: metrics,
    } as ModelVersion);
    return run;
  }

  /** Activar una versión. Si hay una activa, la nueva no puede ser peor (más allá de la tolerancia). */
  async promote(input: { actorId: string; versionId: string }): Promise<ModelVersion> {
    const actor = await this.manager(input.actorId);
    const candidate = await this.repo.findVersion(input.versionId);
    if (!candidate?.lastEvaluation) throw new ValidationError("Primero evaluá esa versión.");
    const active = (await this.repo.findVersions()).find((v) => v.status === "active" && v.id !== candidate.id);
    if (active?.lastEvaluation) {
      const a = active.lastEvaluation;
      const c = candidate.lastEvaluation;
      const tolerance = this.params ? await this.params.number("quality.promote_tolerance") : this.tolerance;
      if (c.f1 < a.f1 - tolerance || c.accuracy < a.accuracy - tolerance) {
        throw new ConflictError(`La versión ${candidate.id} empeora la calidad (F1 ${c.f1} vs ${a.f1}; exactitud ${c.accuracy} vs ${a.accuracy}).`);
      }
      await this.repo.saveVersion({ ...active, status: "retired" });
    }
    const promoted: ModelVersion = { ...candidate, status: "active", promotedAt: this.clock.now(), promotedBy: actor.id };
    await this.repo.saveVersion(promoted);
    await this.events.emit("model.promoted", { userId: actor.id }, { version: promoted.id, f1: promoted.lastEvaluation!.f1 });
    return promoted;
  }

  /** Estado para el equipo: versiones con sus métricas y ejemplos que esperan revisión. */
  async overview(actorId: string): Promise<{ versions: ModelVersion[]; pendingReview: LabeledExample[]; reviewedExamples: number }> {
    await this.manager(actorId);
    const examples = await this.repo.findExamples();
    return { versions: await this.repo.findVersions(), pendingReview: examples.filter((e) => !e.reviewed), reviewedExamples: examples.filter((e) => e.reviewed).length };
  }

  private async manager(actorId: string): Promise<User> {
    const u = await this.users.findById(actorId);
    if (!u || !(await this.authz.permissionsOf(u)).has("quality:manage")) throw new AccessDeniedError("No tenés permiso para gestionar la calidad del algoritmo.", "no_permission");
    return u;
  }
}

export function computeMetrics(rows: { expected: { isSmoke: boolean; types: SmokeType[] }; got: { isSmoke: boolean; types: SmokeType[] } }[]): EvaluationMetrics {
  let tp = 0, fp = 0, fn = 0, ok = 0;
  const perType: Record<string, { tp: number; fp: number; fn: number }> = {};
  for (const { expected, got } of rows) {
    if (expected.isSmoke === got.isSmoke) ok++;
    if (expected.isSmoke && got.isSmoke) tp++;
    else if (!expected.isSmoke && got.isSmoke) fp++;
    else if (expected.isSmoke && !got.isSmoke) fn++;
    for (const t of new Set([...expected.types, ...got.types])) {
      const s = (perType[t] ??= { tp: 0, fp: 0, fn: 0 });
      const e = expected.types.includes(t);
      const g = got.types.includes(t);
      if (e && g) s.tp++;
      else if (g) s.fp++;
      else s.fn++;
    }
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const precision = tp + fp ? tp / (tp + fp) : 1;
  const recall = tp + fn ? tp / (tp + fn) : 1;
  return {
    examples: rows.length,
    accuracy: r2(ok / rows.length),
    precision: r2(precision),
    recall: r2(recall),
    f1: r2(precision + recall ? (2 * precision * recall) / (precision + recall) : 0),
    perType: Object.fromEntries(Object.entries(perType).map(([t, s]) => [t, {
      precision: r2(s.tp + s.fp ? s.tp / (s.tp + s.fp) : 1),
      recall: r2(s.tp + s.fn ? s.tp / (s.tp + s.fn) : 1),
      support: s.tp + s.fn,
    }])),
  };
}

/**
 * "¿TE SIRVIÓ?": opinión de quien recibió el análisis.
 * REGLAS: sólo quien pidió el análisis; una opinión por análisis (se puede cambiar).
 * Un "no me sirvió, se equivocó" se convierte en ejemplo PENDIENTE de revisión
 * (el texto queda para el equipo, nunca se publica).
 */
export class FeedbackService {
  constructor(
    private readonly repo: IQualityRepository,
    private readonly analyses: IContentAnalysisRepository,
    private readonly clock: IClock,
    private readonly params?: IParameterStore,
  ) {}

  async submit(input: { userId: string; analysisId: string; useful: boolean; reason?: FeedbackReason; comment?: string }): Promise<AnalysisFeedback> {
    const a = await this.analyses.findById(input.analysisId);
    if (!a || a.userId !== input.userId) throw new NotFoundError("No existe ese análisis.");
    const f: AnalysisFeedback = {
      id: `${a.id}|${input.userId}`, analysisId: a.id, userId: input.userId, modelVersion: a.modelVersion,
      useful: input.useful, reason: input.reason, comment: input.comment?.slice(0, 1000), at: this.clock.now(),
    };
    await this.repo.saveFeedback(f);
    if (!input.useful && input.reason === "se_equivoco") {
      await this.repo.saveExample({
        id: `fb_${a.id}`, text: a.item.text.slice(0, 5000),
        expected: { isSmoke: a.smoke.smokeIndex < (this.params ? await this.params.number("smoke.threshold") : SMOKE_THRESHOLD), types: [] },
        source: "feedback", reviewed: false, addedBy: input.userId, addedAt: this.clock.now(), note: input.comment,
      });
    }
    return f;
  }

  /** Para la última respuesta del usuario (lo usa el chat: "SÍ" / "NO"). */
  async submitForLatest(userId: string, useful: boolean, withinHours?: number): Promise<AnalysisFeedback | undefined> {
    withinHours ??= this.params ? await this.params.number("feedback.window_hours") : 24;
    const [last] = await this.analyses.findByUser(userId, 1);
    if (!last || this.clock.now().getTime() - last.analyzedAt.getTime() > withinHours * 3_600_000) return undefined;
    return this.submit({ userId, analysisId: last.id, useful, reason: useful ? undefined : "se_equivoco" });
  }

  /** Porcentaje de "me sirvió" por versión del algoritmo. */
  async usefulnessByVersion(since: Date): Promise<Record<string, { total: number; useful: number; rate: number }>> {
    const out: Record<string, { total: number; useful: number; rate: number }> = {};
    for (const f of await this.repo.findFeedback(since)) {
      const k = f.modelVersion ?? "sin-version";
      const s = (out[k] ??= { total: 0, useful: 0, rate: 0 });
      s.total++;
      if (f.useful) s.useful++;
      s.rate = Math.round((s.useful / s.total) * 100) / 100;
    }
    return out;
  }
}
