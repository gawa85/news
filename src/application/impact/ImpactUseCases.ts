import type { ImpactMetrics, ImpactReport, ImpactSnapshot, ImpactTotals, Period, ReplyDraft } from "../../domain/model";
import type {
  IClock,
  IIdGenerator,
  IImpactCollector,
  IImpactRepository,
  ILogger,
  IReplyDraftRepository,
  ITrackedLinkRepository,
} from "../../domain/ports";

/**
 * Mide el impacto de las respuestas publicadas (tarea periódica).
 * Cada destino tiene su recolector; los clics de links propios se suman siempre.
 * Si un recolector falla, se registra y se sigue con los demás.
 */
export class CollectImpactUseCase {
  constructor(
    private readonly drafts: IReplyDraftRepository,
    private readonly collectors: IImpactCollector[],
    private readonly impact: IImpactRepository,
    private readonly links: ITrackedLinkRepository,
    private readonly ids: IIdGenerator,
    private readonly clock: IClock,
    private readonly logger: ILogger,
  ) {}

  async execute(input: { lookbackDays: number }): Promise<ImpactSnapshot[]> {
    const now = this.clock.now();
    const published = await this.drafts.findPublishedBetween(new Date(now.getTime() - input.lookbackDays * 86_400_000), now);
    const snapshots: ImpactSnapshot[] = [];
    for (const draft of published) {
      const metrics: ImpactMetrics = {};
      for (const c of this.collectors.filter((c) => c.supports(draft))) {
        try {
          Object.assign(metrics, await c.collect(draft));
        } catch (err) {
          this.logger.warn("Falló la medición de impacto", { replyId: draft.id, error: String(err) });
        }
      }
      const clicks = (await this.links.findByReply(draft.id)).reduce((s, l) => s + l.clicks, 0);
      if (clicks) metrics.clicks = clicks;
      const snap: ImpactSnapshot = { id: this.ids.next("impact"), replyId: draft.id, destination: draft.target.destination, topic: draft.topic, collectedAt: now, metrics };
      await this.impact.save(snap);
      snapshots.push(snap);
    }
    return snapshots;
  }
}

const zero = (): ImpactTotals => ({
  published: 0, views: 0, reactionsPositive: 0, reactionsNegative: 0, replies: 0, clicks: 0,
  originalsCorrected: 0, originalsRemoved: 0, repliesRemoved: 0,
});

function add(t: ImpactTotals, m: ImpactMetrics | undefined): void {
  t.published++;
  if (!m) return;
  t.views += m.views ?? 0;
  t.reactionsPositive += m.reactionsPositive ?? 0;
  t.reactionsNegative += m.reactionsNegative ?? 0;
  t.replies += m.replies ?? 0;
  t.clicks += m.clicks ?? 0;
  t.originalsCorrected += m.originalCorrected ? 1 : 0;
  t.originalsRemoved += m.originalRemoved ? 1 : 0;
  t.repliesRemoved += m.replyRemoved ? 1 : 0;
}

/** Reporte de impacto: totales, por destino y por tema, con tasas de corrección y de eliminación. */
export class ImpactReportUseCase {
  constructor(
    private readonly drafts: IReplyDraftRepository,
    private readonly impact: IImpactRepository,
  ) {}

  async execute(period: Period): Promise<ImpactReport> {
    const published: ReplyDraft[] = await this.drafts.findPublishedBetween(period.from, period.to);
    const latest = new Map((await this.impact.latestFor(published.map((d) => d.id))).map((s) => [s.replyId, s.metrics]));

    const totals = zero();
    const byDest = new Map<string, ImpactTotals>();
    const byTopic = new Map<string, ImpactTotals>();
    for (const d of published) {
      const m = latest.get(d.id);
      add(totals, m);
      add(getOr(byDest, d.target.destination), m);
      add(getOr(byTopic, d.topic ?? "(sin tema)"), m);
    }
    const rate = (n: number) => (totals.published ? Math.round((n / totals.published) * 100) / 100 : null);
    return {
      period,
      totals,
      byDestination: [...byDest].map(([destination, t]) => ({ destination, ...t })),
      byTopic: [...byTopic].map(([topic, t]) => ({ topic, ...t })),
      removalRate: rate(totals.repliesRemoved),
      correctionRate: rate(totals.originalsCorrected),
    };
  }
}

function getOr(map: Map<string, ImpactTotals>, key: string): ImpactTotals {
  if (!map.has(key)) map.set(key, zero());
  return map.get(key)!;
}
