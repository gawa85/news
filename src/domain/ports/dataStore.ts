/**
 * INTERFAZ DE BASE DE DATOS.
 *
 * El resto del sistema sólo ve `IDataStore`: un conjunto de repositorios más
 * transacciones. Cambiar de motor (memoria, SQLite, PostgreSQL, u otro) es
 * elegir otra implementación en la raíz de composición.
 */
import type { ClaimVerdict, Outlet } from "../model";
import type { IAuditLog } from "./audit";
import type { IRawStore } from "./ops";
import type { IReportScheduleRepository, IStatsRepository } from "./stats";
import type { IBusinessRuleRepository, IPreferencesRepository, ITaxonomyRepository } from "./configuration";
import type { IBrandingRepository, ICouponRepository, IReferralRepository } from "./commerce";
import type { IConsentRepository, IFeatureFlagRepository, ILearningRepository, ITicketRepository } from "./inclusion";
import type { IJobRepository } from "./jobs";
import type { IEvidenceRepository } from "./evidence";
import type { IDigestDeliveryRepository } from "./digest";
import type { ICatalogRepository, IQualityRepository } from "./catalogData";
import type { ICampaignRepository, INarrativeRepository, IPerspectiveRepository, IRoomRepository } from "./participation";
import type { ICostRepository } from "./observability";
import type { IBillingProfileRepository, IInvoiceRepository } from "./billingDocs";
import type { IOfficialDocumentRepository, IVerificationTaskRepository } from "./factcheck";
import type { ICredentialRepository, ILoginAttemptRepository, IMagicLinkRepository, IOAuthStateRepository, ISessionRepository } from "./auth";
import type { ICorrectionRepository, IRebuttalRepository } from "./rebuttals";
import type { IConversationWindowRepository, IDeliveryLog, IDestinationHealthRepository, IOptOutRepository } from "./compliance";
import type { IImpactRepository, ITrackedLinkRepository } from "./impact";
import type { IApiKeyRepository, IWebhookRepository } from "./integrations";
import type { IReplyDraftRepository } from "./replies";
import type { IReviewRepository } from "./reviews";
import type { IContentAnalysisRepository, ISourceConnectionRepository } from "./content";
import type { IAlertRuleRepository, IRuleSetRepository } from "./userRules";
import type { IPlanRepository, IPlanWriter, ISubscriptionRepository, IUsageRepository } from "./billing";
import type { IOrganizationRepository, IRoleRepository, IRoleWriter, IUserRepository } from "./identity";
import type {
  IArticleReader,
  IArticleWriter,
  IClaimReader,
  IClaimWriter,
  IOutletReader,
  IVerdictReader,
} from "./repositories";

export interface IOutletWriter {
  save(outlet: Outlet): Promise<void>;
}

export interface IVerdictWriter {
  save(verdict: ClaimVerdict): Promise<void>;
}

/** Secretos ya cifrados (la bóveda cifra; esto sólo guarda). */
export interface SecretRecord {
  ref: string;
  ciphertext: string;
  createdAt: Date;
}

export interface ISecretRecordRepository {
  get(ref: string): Promise<SecretRecord | undefined>;
  save(record: SecretRecord): Promise<void>;
  delete(ref: string): Promise<void>;
}

export interface VerificationCodeRecord {
  key: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
}

export interface IVerificationCodeRepository {
  get(key: string): Promise<VerificationCodeRecord | undefined>;
  save(record: VerificationCodeRecord): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Repositories {
  outlets: IOutletReader & IOutletWriter;
  articles: IArticleReader & IArticleWriter;
  claims: IClaimReader & IClaimWriter;
  verdicts: IVerdictReader & IVerdictWriter;
  users: IUserRepository;
  roles: IRoleRepository & IRoleWriter;
  organizations: IOrganizationRepository;
  plans: IPlanRepository & IPlanWriter;
  subscriptions: ISubscriptionRepository;
  usage: IUsageRepository;
  ruleSets: IRuleSetRepository;
  alerts: IAlertRuleRepository;
  contentAnalyses: IContentAnalysisRepository;
  sourceConnections: ISourceConnectionRepository;
  secrets: ISecretRecordRepository;
  verificationCodes: IVerificationCodeRepository;
  replyDrafts: IReplyDraftRepository;
  apiKeys: IApiKeyRepository;
  webhooks: IWebhookRepository;
  reviews: IReviewRepository;
  impact: IImpactRepository;
  trackedLinks: ITrackedLinkRepository;
  deliveryLog: IDeliveryLog;
  destinationHealth: IDestinationHealthRepository;
  optOuts: IOptOutRepository;
  conversationWindows: IConversationWindowRepository;
  audit: IAuditLog;
  sessions: ISessionRepository;
  credentials: ICredentialRepository;
  magicLinks: IMagicLinkRepository;
  oauthStates: IOAuthStateRepository;
  loginAttempts: ILoginAttemptRepository;
  rebuttals: IRebuttalRepository;
  corrections: ICorrectionRepository;
  jobs: IJobRepository;
  verificationTasks: IVerificationTaskRepository;
  officialDocuments: IOfficialDocumentRepository;
  billingProfiles: IBillingProfileRepository;
  invoices: IInvoiceRepository;
  costs: ICostRepository;
  narratives: INarrativeRepository;
  campaigns: ICampaignRepository;
  perspectives: IPerspectiveRepository;
  rooms: IRoomRepository;
  catalog: ICatalogRepository;
  quality: IQualityRepository;
  stats: IStatsRepository;
  reportSchedules: IReportScheduleRepository;
  taxonomy: ITaxonomyRepository;
  preferences: IPreferencesRepository;
  businessRules: IBusinessRuleRepository;
  coupons: ICouponRepository;
  referrals: IReferralRepository;
  branding: IBrandingRepository;
  learning: ILearningRepository;
  tickets: ITicketRepository;
  featureFlags: IFeatureFlagRepository;
  media: IMediaRepository;
  consents: IConsentRepository;
  evidence: IEvidenceRepository;
  /** Copias archivadas guardadas en la base (cuando no hay disco ni S3 configurado). */
  evidenceBlobs: IEvidenceBlobRepository;
  digests: IDigestDeliveryRepository;
}

export interface IEvidenceBlobRepository {
  put(b: { key: string; mime: string; dataBase64: string }): Promise<void>;
  get(key: string): Promise<{ key: string; mime: string; dataBase64: string } | undefined>;
}

/** Archivos propios (audios) guardados en la base, con vencimiento. */
export interface IMediaRepository {
  put(m: { id: string; mime: string; dataBase64: string; expiresAt: Date }): Promise<void>;
  get(id: string): Promise<{ id: string; mime: string; dataBase64: string; expiresAt: Date } | undefined>;
  deleteExpired(now: Date): Promise<void>;
}

/** Ejecuta varias operaciones de forma atómica: o se guardan todas o ninguna. */
export interface IUnitOfWork {
  transaction<T>(work: (repos: Repositories) => Promise<T>): Promise<T>;
}

export interface IDataStore extends IUnitOfWork {
  readonly engine: string;
  readonly repos: Repositories;
  /** Acceso a todas las colecciones para copias de seguridad. */
  readonly raw: IRawStore;
  /** Crea o actualiza tablas e índices. */
  migrate(): Promise<void>;
  close(): Promise<void>;
}
