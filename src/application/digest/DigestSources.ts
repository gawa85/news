/**
 * PARTES DEL RESUMEN. Cada una es independiente (SRP) y cumple el mismo contrato (LSP):
 * sumar una parte nueva = escribir otra clase y agregarla a la lista (OCP).
 */
import type { DigestSection, EvidenceSnapshot } from "../../domain/model";
import type {
  DigestContext,
  IArticleReader,
  ICorrectionRepository,
  IDigestSource,
  IEvidenceRepository,
  INarrativeRepository,
  IOutletReader,
  ITaxonomyRepository,
} from "../../domain/ports";

const MAX_ITEMS = 5;
const inWindow = (d: Date, ctx: DigestContext) => d > ctx.from && d <= ctx.to;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function section(source: string, title: string, items: DigestSection["items"]): DigestSection | undefined {
  if (items.length === 0) return undefined;
  return { source, title, items: items.slice(0, MAX_ITEMS), ...(items.length > MAX_ITEMS ? { more: items.length - MAX_ITEMS } : {}) };
}

/** Notas que la persona (o su organización) vigila: ediciones silenciosas y borrados. */
export class WatchedNotesDigestSource implements IDigestSource {
  readonly id = "evidencias";

  constructor(private readonly evidence: IEvidenceRepository) {}

  async collect(ctx: DigestContext): Promise<DigestSection | undefined> {
    const subjects = [ctx.user.id, ctx.user.organizationId].filter((s): s is string => !!s);
    const found: EvidenceSnapshot[] = [];
    for (const s of subjects) found.push(...(await this.evidence.findBySubject(s)));
    const events = found
      .filter((s) => s.reason === "recheck" && inWindow(s.capturedAt, ctx))
      .filter((s) => s.status === "gone" || (s.change && (s.change.added.length || s.change.removed.length)))
      .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime());
    const items = await Promise.all(
      events.map(async (s) => {
        const name = s.title ?? (s.previousId ? (await this.evidence.findById(s.previousId))?.title : undefined) ?? new URL(s.finalUrl).hostname;
        if (s.status === "gone") return { text: `Borraron «${clip(name, 80)}».`, url: s.url };
        const before = s.change!.removed[0];
        const after = s.change!.added[0];
        const what = before && after ? `«${clip(before, 70)}» → «${clip(after, 70)}»` : after ? `agregaron «${clip(after, 90)}»` : `quitaron «${clip(before!, 90)}»`;
        return { text: `Editaron «${clip(name, 60)}»: ${what}`, url: s.url };
      }),
    );
    return section(this.id, "Notas que vigilás", items);
  }
}

/** Notas nuevas en los temas que sigue la persona. */
export class FollowedTopicsDigestSource implements IDigestSource {
  readonly id = "temas";

  constructor(
    private readonly articles: IArticleReader,
    private readonly outlets: IOutletReader,
    private readonly taxonomy: Pick<ITaxonomyRepository, "findTopics">,
  ) {}

  async collect(ctx: DigestContext): Promise<DigestSection | undefined> {
    if (ctx.prefs.followedTopics.length === 0) return undefined;
    const topics = (await this.taxonomy.findTopics()).filter((t) => t.active && ctx.prefs.followedTopics.includes(t.id));
    const names = new Map((await this.outlets.findAll()).map((o) => [o.id, o.name]));
    const items: DigestSection["items"] = [];
    for (const t of topics) {
      const found = (await this.articles.find({ topic: t.name, period: { from: ctx.from, to: ctx.to } }))
        .filter((a) => inWindow(a.publishedAt, ctx))
        .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
      if (found.length === 0) continue;
      const top = found[0]!;
      const n = found.length === 1 ? "1 nota nueva" : `${found.length} notas nuevas`;
      items.push({ text: `${t.name}: ${n}. La última: «${clip(top.title, 90)}» (${names.get(top.outletId) ?? top.outletId}).`, url: top.url });
    }
    return section(this.id, "Tus temas", items);
  }
}

/** Las cadenas y narrativas que más circulan (en sus temas, si sigue alguno). */
export class CirculatingNarrativesDigestSource implements IDigestSource {
  readonly id = "cadenas";

  constructor(
    private readonly narratives: INarrativeRepository,
    private readonly taxonomy: Pick<ITaxonomyRepository, "findTopics">,
    private readonly limit = 3,
  ) {}

  async collect(ctx: DigestContext): Promise<DigestSection | undefined> {
    const followed = new Set(
      (await this.taxonomy.findTopics()).filter((t) => ctx.prefs.followedTopics.includes(t.id)).flatMap((t) => [t.id, t.name.toLowerCase()]),
    );
    const top = (await this.narratives.findTop(ctx.from, 20))
      .filter((n) => n.status === "circulating")
      .filter((n) => followed.size === 0 || (n.topic && followed.has(n.topic.toLowerCase())));
    const items = top.slice(0, this.limit).map((n) => ({ text: `«${clip(n.sample, 110)}» — ${n.occurrences} veces, humo ${Math.round(n.avgSmokeIndex)}/100.` }));
    return section(this.id, "Cadenas que circulan", items);
  }
}

/** Fe de erratas publicadas por los medios (buena señal: corregir suma credibilidad). */
export class CorrectionsDigestSource implements IDigestSource {
  readonly id = "erratas";

  constructor(
    private readonly corrections: ICorrectionRepository,
    private readonly outlets: IOutletReader,
  ) {}

  async collect(ctx: DigestContext): Promise<DigestSection | undefined> {
    const names = new Map((await this.outlets.findAll()).map((o) => [o.id, o.name]));
    const items = (await this.corrections.findRecent(50))
      .filter((c) => inWindow(c.publishedAt, ctx))
      .map((c) => ({ text: `${c.outletId ? `${names.get(c.outletId) ?? c.outletId}: ` : ""}${clip(c.description, 140)}` }));
    return section(this.id, "Fe de erratas", items);
  }
}
