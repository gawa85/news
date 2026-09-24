import { ValidationError } from "../../domain/errors";
import { urlMatches, type AnalyzedLink, type ContentAnalysis, type ContentItem } from "../../domain/model";
import type {
  IClock,
  IContentAnalysisRepository,
  IIdGenerator,
  IOutletReader,
  ISignalProvider,
  ISmokeDetector,
} from "../../domain/ports";

/**
 * Analiza CUALQUIER contenido (mail, mensaje, RSS, post...) de la misma forma:
 *  1. humo del texto (incluye el texto de los adjuntos, si se pudo extraer),
 *  2. links: a qué dominios apunta y si son medios registrados,
 *  3. señales sobre la fuente: cada ISignalProvider aporta las suyas (OCP).
 */
export class AnalyzeContentUseCase {
  constructor(
    private readonly smoke: ISmokeDetector,
    private readonly signalProviders: ISignalProvider[],
    private readonly outlets: IOutletReader,
    private readonly analyses: IContentAnalysisRepository,
    private readonly ids: IIdGenerator,
    private readonly clock: IClock,
    private readonly maxChars = 20_000,
  ) {}

  async execute(input: { userId: string; item: ContentItem }): Promise<ContentAnalysis> {
    const { item } = input;
    const text = [item.text, ...item.attachments.map((a) => a.text ?? "")].join("\n").trim();
    if (!text) throw new ValidationError("El contenido no tiene texto para analizar.");

    const applicable = this.signalProviders.filter((p) => p.appliesTo(item));
    const [smoke, signalGroups, links] = await Promise.all([
      this.smoke.analyze(text.slice(0, this.maxChars)),
      Promise.all(applicable.map((p) => p.signals(item))),
      this.analyzeLinks(item.urls),
    ]);

    const analysis: ContentAnalysis = {
      id: this.ids.next("analysis"),
      userId: input.userId,
      item: { ...item, html: undefined }, // no se guarda el HTML completo
      smoke,
      signals: signalGroups.flat(),
      links,
      analyzedAt: this.clock.now(),
      modelVersion: this.smoke.version,
    };
    await this.analyses.save(analysis);
    return analysis;
  }

  private async analyzeLinks(urls: string[]): Promise<AnalyzedLink[]> {
    const outlets = await this.outlets.findAll();
    return [...new Set(urls)].slice(0, 50).flatMap((url) => {
      try {
        const domain = new URL(url).hostname.replace(/^www\./, "");
        return [{ url, domain, outletId: outlets.find((o) => urlMatches(url, o.url))?.id }];
      } catch {
        return [];
      }
    });
  }
}
