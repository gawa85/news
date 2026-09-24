/**
 * RAÍZ DE COMPOSICIÓN.
 *
 * Es el ÚNICO lugar del sistema que conoce las clases concretas. Acá se decide
 * qué implementación va detrás de cada interfaz. Cambiar reglas por IA, memoria
 * por Postgres o un proveedor de noticias por otro se hace SOLO en este archivo.
 */
import { AnalyzeSmokeUseCase } from "../application/AnalyzeSmokeUseCase";
import { CompareSourcesUseCase } from "../application/CompareSourcesUseCase";
import { CredibilityTimelineUseCase } from "../application/CredibilityTimelineUseCase";
import { EvaluateCredibilityUseCase } from "../application/EvaluateCredibilityUseCase";
import { IngestArticlesUseCase } from "../application/IngestArticlesUseCase";
import { SourceCollector } from "../application/SourceCollector";
import { TraceOriginUseCase } from "../application/TraceOriginUseCase";
import type {
  AdvertisingSpend,
  Article,
  Outlet,
  Owner,
  OwnershipRecord,
} from "../domain/model";
import type {
  IArticleFetcher,
  IClaimExtractor,
  IClock,
  IDataStore,
  IDisagreementClassifier,
  IIdGenerator,
  ILogger,
  ISmokeDetector,
} from "../domain/ports";
import { CatalogAdvertisingSource, CatalogOwnershipRegistry, StoredNewsProvider } from "../infrastructure/catalog/CatalogAdapters";
import { KeywordTopicSectorMapper, StaticPoliticalContextProvider, type RegionalContext } from "../infrastructure/context/StaticContextSources";
import { AccuracyDimension } from "../infrastructure/credibility/AccuracyDimension";
import { ConflictOfInterestDimension } from "../infrastructure/credibility/ConflictOfInterestDimension";
import { ConsistencyDimension } from "../infrastructure/credibility/ConsistencyDimension";
import { OfficialAdvertisingDimension } from "../infrastructure/credibility/OfficialAdvertisingDimension";
import { SourcingQualityDimension } from "../infrastructure/credibility/SourcingQualityDimension";
import { WeightedAveragePolicy } from "../infrastructure/credibility/WeightedAveragePolicy";
import { JaccardSimilarity } from "../infrastructure/heuristics/JaccardSimilarity";
import { LexiconStanceDetector } from "../infrastructure/heuristics/LexiconStanceDetector";
import { RuleBasedDisagreementClassifier } from "../infrastructure/heuristics/RuleBasedDisagreementClassifier";
import { RuleBasedSmokeDetector } from "../infrastructure/heuristics/RuleBasedSmokeDetector";
import { SentenceClaimExtractor } from "../infrastructure/heuristics/SentenceClaimExtractor";
import { SimilarityClaimClusterer } from "../infrastructure/heuristics/SimilarityClaimClusterer";
import { AnthropicLLMClient } from "../infrastructure/llm/AnthropicLLMClient";
import type { ILLMClient } from "../infrastructure/llm/ILLMClient";
import { LLMClaimExtractor } from "../infrastructure/llm/LLMClaimExtractor";
import { LLMDisagreementClassifier } from "../infrastructure/llm/LLMDisagreementClassifier";
import { LLMSmokeDetector } from "../infrastructure/llm/LLMSmokeDetector";
import { HttpArticleFetcher, InMemoryArticleFetcher } from "../infrastructure/news/ArticleFetchers";
import { CompositeNewsSearchProvider } from "../infrastructure/news/CompositeNewsSearchProvider";
import { InMemoryNewsProvider } from "../infrastructure/news/InMemoryNewsProvider";
import { MaxPerOutletSelectionPolicy } from "../infrastructure/news/MaxPerOutletSelectionPolicy";
import { ConsoleLogger, RandomIdGenerator, SystemClock } from "../infrastructure/system/System";

export interface SeedData {
  outlets: Outlet[];
  owners: Owner[];
  ownership: OwnershipRecord[];
  /** Notas que devuelve la búsqueda. */
  searchableArticles: Article[];
  /** Notas que sólo se pueden traer pidiendo su URL (no aparecen en la búsqueda). */
  fetchableArticles: Article[];
  advertising: AdvertisingSpend[];
  politicalContexts: RegionalContext[];
  topicSectors: Record<string, string[]>;
}

export type AIConfig = { provider: "rules" } | { provider: "anthropic"; apiKey: string; model: string };

export interface AppConfig {
  /** Base de datos: memoria, SQLite o PostgreSQL. Ver infrastructure/persistence/stores.ts */
  store: IDataStore;
  ai: AIConfig;
  fetcher: "memory" | "http";
  seed: SeedData;
  clock?: IClock;
  logger?: ILogger;
  ids?: IIdGenerator;
  /**
   * Decoradores opcionales: envolver el cliente de IA (p. ej. para medir costos) o el
   * detector de humo (p. ej. caché) sin modificar el núcleo.
   */
  decorate?: {
    llm?: (client: ILLMClient) => ILLMClient;
    smokeDetector?: (detector: ISmokeDetector) => ISmokeDetector;
  };
}

export function buildApp(config: AppConfig) {
  const { seed } = config;
  const logger = config.logger ?? new ConsoleLogger();
  const clock = config.clock ?? new SystemClock();
  const ids = config.ids ?? new RandomIdGenerator();

  // --- Persistencia: el motor lo decide quien llama; acá sólo se usan interfaces ---
  const { outlets, articles, claims, verdicts, catalog } = config.store.repos;

  // --- Análisis de texto: reglas o IA, según configuración ---
  const similarity = new JaccardSimilarity();
  let smokeDetector: ISmokeDetector;
  let extractor: IClaimExtractor;
  let classifier: IDisagreementClassifier;
  if (config.ai.provider === "anthropic") {
    const raw = new AnthropicLLMClient({ apiKey: config.ai.apiKey, model: config.ai.model });
    const llm = config.decorate?.llm ? config.decorate.llm(raw) : raw;
    smokeDetector = new LLMSmokeDetector(llm, config.ai.model);
    extractor = new LLMClaimExtractor(llm);
    classifier = new LLMDisagreementClassifier(llm);
  } else {
    smokeDetector = new RuleBasedSmokeDetector();
    extractor = new SentenceClaimExtractor();
    classifier = new RuleBasedDisagreementClassifier();
  }
  if (config.decorate?.smokeDetector) smokeDetector = config.decorate.smokeDetector(smokeDetector);
  const clusterer = new SimilarityClaimClusterer(similarity, ids);

  // --- Noticias: varios proveedores combinados + URLs que pide el usuario ---
  // Las notas que entraron por los feeds del catálogo (base) + las del proveedor configurado.
  const news = new CompositeNewsSearchProvider([new StoredNewsProvider(articles), new InMemoryNewsProvider(seed.searchableArticles)], logger);
  const fetcher: IArticleFetcher =
    config.fetcher === "http" ? new HttpArticleFetcher(outlets, ids) : new InMemoryArticleFetcher(seed.fetchableArticles);
  const sourceCollector = new SourceCollector(news, fetcher, outlets, new MaxPerOutletSelectionPolicy(3), logger);

  // --- Contexto: dueños y pauta salen del CATÁLOGO en la base (importable); coyuntura, de config ---
  const ownership = new CatalogOwnershipRegistry(catalog);
  const advertising = new CatalogAdvertisingSource(catalog);
  const politics = new StaticPoliticalContextProvider(seed.politicalContexts);
  const sectors = new KeywordTopicSectorMapper(seed.topicSectors);

  // --- Credibilidad: la lista de dimensiones se arma acá (OCP) ---
  const dimensions = [
    new AccuracyDimension(verdicts),
    new SourcingQualityDimension(),
    new ConflictOfInterestDimension(ownership, sectors),
    new OfficialAdvertisingDimension(advertising, politics, { highMonthlyAmount: 10_000_000, currency: "ARS" }),
    new ConsistencyDimension(politics, new LexiconStanceDetector()),
  ];
  const aggregation = new WeightedAveragePolicy({ accuracy: 3, sourcing: 2, conflict_of_interest: 1, official_advertising: 1, consistency: 1 });
  const evaluateCredibility = new EvaluateCredibilityUseCase(outlets, articles, claims, dimensions, aggregation, clock);

  return {
    analyzeSmoke: new AnalyzeSmokeUseCase(smokeDetector, logger),
    compareSources: new CompareSourcesUseCase(sourceCollector, extractor, clusterer, classifier, articles, claims, logger),
    ingestArticles: new IngestArticlesUseCase(sourceCollector, extractor, articles, claims, logger),
    traceOrigin: new TraceOriginUseCase(articles, outlets, similarity),
    evaluateCredibility,
    credibilityTimeline: new CredibilityTimelineUseCase(evaluateCredibility),
    /** Acceso de administración (carga de verificaciones). En producción sería otro caso de uso. */
    admin: { verdicts, claims, outlets, articles },
    smokeDetector,
    extractor,
    ids,
    logger,
    clock,
  };
}

/** Carga inicial de medios (catálogo) en la base. */
export async function seedCore(store: IDataStore, seed: SeedData): Promise<void> {
  const { outlets, catalog } = store.repos;
  for (const o of seed.outlets) await outlets.save(o);
  for (const o of seed.owners) await catalog.saveOwner(o);
  for (const r of seed.ownership) await catalog.saveOwnership({ source: "semilla", ...r });
  for (const a of seed.advertising) await catalog.saveAdvertising({ source: "semilla", ...a });
}

export type App = ReturnType<typeof buildApp>;
