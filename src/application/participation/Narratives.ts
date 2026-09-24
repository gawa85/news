import type { ContentAnalysis, Narrative } from "../../domain/model";
import type { IClock, IContentAnalysisRepository, IEventBus, IIdGenerator, INarrativeRepository, ITextSimilarity } from "../../domain/ports";

/** Semana ISO ("2026-W39"). */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Oculta teléfonos y mails: las muestras de cadenas no deben exponer datos personales. */
export function redact(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[mail]")
    .replace(/\+?\d[\d\s-]{7,}\d/g, "[teléfono]")
    .slice(0, 600);
}

export interface NarrativeOptions {
  similarityThreshold: number;
  /** Sólo cuenta contenido con humo (no tiene sentido rastrear mensajes normales). */
  minSmokeIndex: number;
  activeDays: number;
}

/**
 * DETECTOR DE NARRATIVAS: agrupa los contenidos que llegan (cadenas, mails reenviados)
 * en "humo en circulación". Escucha "analysis.completed"; no guarda quién lo mandó.
 */
export class NarrativeTracker {
  private readonly opts: NarrativeOptions;

  constructor(
    private readonly narratives: INarrativeRepository,
    private readonly analyses: IContentAnalysisRepository,
    private readonly similarity: ITextSimilarity,
    private readonly ids: IIdGenerator,
    private readonly clock: IClock,
    opts: Partial<NarrativeOptions> = {},
  ) {
    this.opts = { similarityThreshold: 0.6, minSmokeIndex: 30, activeDays: 60, ...opts };
  }

  attach(bus: IEventBus): void {
    bus.subscribe(async (e) => {
      if (e.type !== "analysis.completed") return;
      const a = await this.analyses.findById(String(e.data.analysisId));
      if (a) await this.track(a);
    });
  }

  async track(a: ContentAnalysis): Promise<Narrative | undefined> {
    if (!["message", "email", "social"].includes(a.item.sourceType) || a.smoke.smokeIndex < this.opts.minSmokeIndex) return undefined;
    const text = a.item.text;
    const now = this.clock.now();
    const active = await this.narratives.findActiveSince(new Date(now.getTime() - this.opts.activeDays * 86_400_000));
    let best: Narrative | undefined;
    let bestSim = 0;
    for (const n of active) {
      const sim = this.similarity.similarity(n.sample, text);
      if (sim > bestSim) (bestSim = sim), (best = n);
    }
    const channel = String(a.item.metadata.channel ?? a.item.sourceType);
    const week = isoWeek(now);
    const n: Narrative =
      best && bestSim >= this.opts.similarityThreshold
        ? {
            ...best,
            lastSeenAt: now,
            occurrences: best.occurrences + 1,
            byChannel: { ...best.byChannel, [channel]: (best.byChannel[channel] ?? 0) + 1 },
            weekly: { ...best.weekly, [week]: (best.weekly[week] ?? 0) + 1 },
            avgSmokeIndex: Math.round((best.avgSmokeIndex * best.occurrences + a.smoke.smokeIndex) / (best.occurrences + 1)),
          }
        : {
            id: this.ids.next("narrative"),
            sample: redact(text),
            keywords: [],
            firstSeenAt: now,
            lastSeenAt: now,
            occurrences: 1,
            byChannel: { [channel]: 1 },
            weekly: { [week]: 1 },
            avgSmokeIndex: a.smoke.smokeIndex,
            status: "circulating",
            campaignIds: [],
          };
    await this.narratives.save(n);
    return n;
  }

  top(days: number, limit = 20): Promise<Narrative[]> {
    return this.narratives.findTop(new Date(this.clock.now().getTime() - days * 86_400_000), limit);
  }
}
