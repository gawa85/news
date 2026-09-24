import type {
  AdvertisingSpend,
  AnalysisFeedback,
  CatalogBatch,
  EvaluationRun,
  FeedSource,
  LabeledExample,
  ModelVersion,
  Outlet,
  Owner,
  OwnershipRecord,
  Period,
} from "../model";

export interface ICatalogRepository {
  findOwners(ids?: string[]): Promise<Owner[]>;
  saveOwner(o: Owner): Promise<void>;
  findOwnership(outletId: string): Promise<OwnershipRecord[]>;
  saveOwnership(r: OwnershipRecord): Promise<void>;
  findAdvertising(outletId: string, period: Period): Promise<AdvertisingSpend[]>;
  saveAdvertising(a: AdvertisingSpend): Promise<void>;
  findActiveFeeds(): Promise<FeedSource[]>;
  saveFeed(f: FeedSource): Promise<void>;
}

/**
 * FUENTE DEL CATÁLOGO: de dónde salen los medios, sus dueños, su pauta y sus feeds.
 * Un CSV propio, un dataset de datos abiertos de un gobierno, un registro público…
 */
export interface IOutletCatalogSource {
  readonly id: string;
  readonly label: string;
  load(ctx: { outlets: Outlet[] }): Promise<CatalogBatch>;
}

export interface FeedItem {
  title: string;
  link?: string;
  text: string;
  publishedAt: Date;
}

/** Lee un feed RSS/Atom y devuelve sus notas con el texto ya limpio. */
export interface IFeedReader {
  read(url: string): Promise<FeedItem[]>;
}

/** Clasifica una nota en un tema (palabras clave, o un modelo). */
export interface ITopicClassifier {
  classify(text: string): Promise<string | undefined>;
}

export interface IQualityRepository {
  findExamples(): Promise<LabeledExample[]>;
  saveExample(e: LabeledExample): Promise<void>;
  findVersion(id: string): Promise<ModelVersion | undefined>;
  findVersions(): Promise<ModelVersion[]>;
  saveVersion(v: ModelVersion): Promise<void>;
  saveRun(r: EvaluationRun): Promise<void>;
  findRuns(modelVersion: string): Promise<EvaluationRun[]>;
  saveFeedback(f: AnalysisFeedback): Promise<void>;
  findFeedback(since: Date): Promise<AnalysisFeedback[]>;
}
