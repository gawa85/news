import { NotFoundError } from "../domain/errors";
import type { OriginLink, OriginTrace } from "../domain/model";
import type { IArticleReader, IOutletReader, ITextSimilarity } from "../domain/ports";

export interface TraceOriginOptions {
  /** Desde qué parecido se considera que dos notas hablan de lo mismo. */
  relatedThreshold: number;
  /** Desde qué parecido se considera que una nota es casi copia de otra. */
  copyThreshold: number;
  lookbackDays: number;
}

const DEFAULTS: TraceOriginOptions = { relatedThreshold: 0.25, copyThreshold: 0.6, lookbackDays: 7 };

/** Caso de uso 3: "¿quién lo dijo primero?" y detección de falso consenso. */
export class TraceOriginUseCase {
  private readonly opts: TraceOriginOptions;

  constructor(
    private readonly articles: IArticleReader,
    private readonly outlets: IOutletReader,
    private readonly similarity: ITextSimilarity,
    opts: Partial<TraceOriginOptions> = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  async execute(input: { articleId: string }): Promise<OriginTrace> {
    const target = await this.articles.findById(input.articleId);
    if (!target) throw new NotFoundError(`No existe el artículo ${input.articleId}.`);

    const from = new Date(target.publishedAt.getTime() - this.opts.lookbackDays * 86_400_000);
    const candidates = await this.articles.find({
      topic: target.topic,
      period: { from, to: target.publishedAt },
    });

    const related = candidates
      .filter((a) => a.id === target.id || this.similarity.similarity(a.body, target.body) >= this.opts.relatedThreshold)
      .sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime());

    const origin = related[0] ?? target;
    const chain: OriginLink[] = related.map((article) => {
      const sim = article.id === origin.id ? 1 : this.similarity.similarity(article.body, origin.body);
      return { article, similarityToOrigin: round(sim), isNearCopy: article.id !== origin.id && sim >= this.opts.copyThreshold };
    });

    const copies = chain.filter((l) => l.isNearCopy).length;
    const independentSources = chain.length - copies;
    const originOutlet = await this.outlets.findById(origin.outletId);
    const likelyPressRelease =
      originOutlet?.kind === "official" || originOutlet?.kind === "wire_agency" || copies >= 2;

    return {
      target,
      origin,
      chain,
      independentSources,
      likelyPressRelease,
      echoWarning:
        copies >= 2
          ? `${chain.length} notas, pero ${copies} son casi copia del mismo texto: hay ${independentSources} fuente(s) independiente(s), no ${chain.length}.`
          : undefined,
    };
  }
}

const round = (n: number) => Math.round(n * 100) / 100;
