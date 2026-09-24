import { randomUUID } from "node:crypto";
import { AccessDeniedError } from "../../domain/errors";
import type {
  AccessContext,
  ActionId,
  ChannelType,
  ContentAnalysis,
  ContentItem,
  Correction,
  CredibilityQuery,
  CredibilityReport,
  CredibilityTimelinePoint,
  DomainEventType,
  OriginTrace,
  Permission,
  Rebuttal,
  SmokeAnalysis,
  SourceComparison,
} from "../../domain/model";
import type { IClock, IEventBus, IMetrics, IRequestContext, ITopicResolver, NewsQuery } from "../../domain/ports";
import type { AnalyzeContentUseCase } from "../content/AnalyzeContentUseCase";
import type { AnalyzeSmokeUseCase } from "../AnalyzeSmokeUseCase";
import type { CompareSourcesUseCase } from "../CompareSourcesUseCase";
import type { CredibilityTimelineUseCase } from "../CredibilityTimelineUseCase";
import type { EvaluateCredibilityUseCase } from "../EvaluateCredibilityUseCase";
import type { TraceOriginUseCase } from "../TraceOriginUseCase";
import type { UserRulesResolver } from "../rules/UserRulesResolver";
import type { AccessControl } from "./AccessControl";

export interface CoreUseCases {
  analyzeSmoke: AnalyzeSmokeUseCase;
  analyzeContent: AnalyzeContentUseCase;
  compareSources: CompareSourcesUseCase;
  traceOrigin: TraceOriginUseCase;
  evaluateCredibility: EvaluateCredibilityUseCase;
  credibilityTimeline: CredibilityTimelineUseCase;
}

/** Quién pide: el usuario, por qué canal y (si viene por API/MCP) con qué alcances. */
export interface Caller {
  userId: string;
  channel: ChannelType;
  /** Alcances de la clave de API: se intersectan con los permisos del rol. */
  scopes?: ReadonlySet<Permission>;
}

export interface GatewayObservability {
  metrics?: IMetrics;
  /** Contexto del pedido: permite atribuir costos (IA, mensajes) al cliente correcto. */
  context?: IRequestContext;
}

type PublicRecord = (outletId: string) => Promise<{ rebuttals: Rebuttal[]; corrections: Correction[] }>;

/**
 * PUNTO DE ENTRADA ÚNICO al producto. Web, WhatsApp, Telegram, mail, API, bots y MCP
 * pasan todos por acá, así las reglas (rol, plan, cuota, reglas del usuario) son
 * las mismas sin importar por dónde llegue el pedido.
 *
 * Cada pedido: autorización → contexto (para costos) → caso de uso → consumo → métricas.
 */
export class ProductGateway {
  constructor(
    private readonly access: AccessControl,
    private readonly userRules: UserRulesResolver,
    private readonly core: CoreUseCases,
    private readonly events: IEventBus,
    private readonly clock: IClock,
    /** Réplicas y correcciones públicas de un medio: se muestran SIEMPRE junto a su credibilidad. */
    private readonly publicRecord: PublicRecord = async () => ({ rebuttals: [], corrections: [] }),
    private readonly obs: GatewayObservability = {},
    /** Temas de la taxonomía: "gas" → "tarifas de gas" (así la búsqueda y las reglas usan el nombre oficial). */
    private readonly topics?: ITopicResolver,
  ) {}

  analyzeSmoke(caller: Caller, text: string): Promise<SmokeAnalysis> {
    return this.run(caller, "analyze_smoke", {}, async (ctx) => {
      const r = await this.core.analyzeSmoke.execute({ text });
      await this.emit("analysis.completed", ctx, {
        sourceType: "text", smokeIndex: r.smokeIndex, smokeTypes: [...new Set(r.findings.map((f) => f.type))], channel: caller.channel,
      });
      return r;
    });
  }

  analyzeContent(caller: Caller, item: ContentItem): Promise<ContentAnalysis> {
    return this.run(caller, "analyze_content", {}, async (ctx) => {
      const r = await this.core.analyzeContent.execute({ userId: caller.userId, item });
      await this.emit("analysis.completed", ctx, {
        analysisId: r.id, sourceType: item.sourceType, smokeIndex: r.smoke.smokeIndex,
        smokeTypes: [...new Set(r.smoke.findings.map((f) => f.type))], channel: caller.channel,
      });
      return r;
    });
  }

  async compareSources(caller: Caller, input: NewsQuery): Promise<SourceComparison & { blockedIncludes: string[] }> {
    const user = await this.access.userOrThrow(caller.userId);
    const canonical = input.topic.trim() ? await this.topics?.resolve(input.topic) : undefined;
    const query = canonical ? { ...input, topic: canonical.name } : input;
    const { rules, blockedIncludes } = await this.userRules.resolve(user, query.urlRules);
    return this.run(caller, "compare_sources", { includeUrls: rules.include?.length ?? 0, topic: query.topic }, async (ctx) => {
      const maxOutlets = ctx.plan.limits.maxSourcesPerComparison ?? undefined;
      const r = await this.core.compareSources.execute({ ...query, urlRules: rules, maxOutlets });
      await this.emit("comparison.completed", ctx, {
        topic: r.topic,
        sources: r.outletIds.length,
        disagreements: r.disagreements.length,
        // Los datos en disputa se convierten en tareas para el equipo de verificación.
        factualDisputes: r.disagreements.filter((d) => d.type === "factual").map((d) => ({ topic: r.topic, description: d.description, positions: d.positions })),
      });
      return { ...r, blockedIncludes };
    });
  }

  traceOrigin(caller: Caller, articleId: string): Promise<OriginTrace> {
    return this.run(caller, "trace_origin", {}, () => this.core.traceOrigin.execute({ articleId }));
  }

  evaluateCredibility(caller: Caller, query: CredibilityQuery): Promise<CredibilityReport & { rebuttals: Rebuttal[]; corrections: Correction[] }> {
    return this.run(caller, "evaluate_credibility", {}, async () => {
      const r = await this.core.evaluateCredibility.evaluate(query);
      return { ...r, ...(await this.publicRecord(query.outletId)) };
    });
  }

  credibilityTimeline(caller: Caller, query: CredibilityQuery, windows: number): Promise<CredibilityTimelinePoint[]> {
    return this.run(caller, "credibility_timeline", {}, () => this.core.credibilityTimeline.execute(query, windows));
  }

  private async run<T>(caller: Caller, action: ActionId, request: AccessContext["request"], fn: (ctx: AccessContext) => Promise<T>): Promise<T> {
    const started = Date.now();
    let outcome = "ok";
    try {
      const ctx = await this.access.authorize(caller.userId, action, caller.channel, request, caller.scopes);
      const info = { userId: ctx.user.id, subjectId: ctx.subscription.subject.id, action };
      const result = this.obs.context ? await this.obs.context.run(info, () => fn(ctx)) : await fn(ctx);
      await this.access.recordUsage(ctx);
      return result;
    } catch (err) {
      outcome = err instanceof AccessDeniedError ? `denied:${err.code}` : "error";
      throw err;
    } finally {
      this.obs.metrics?.increment("sinhumo_requests_total", { action, channel: caller.channel, outcome });
      this.obs.metrics?.observe("sinhumo_request_seconds", (Date.now() - started) / 1000, { action });
    }
  }

  private emit(type: DomainEventType, ctx: AccessContext, data: Record<string, unknown>) {
    return this.events.publish({ id: randomUUID(), type, userId: ctx.user.id, organizationId: ctx.user.organizationId, occurredAt: this.clock.now(), data });
  }
}
