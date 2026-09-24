/**
 * Arma la plataforma a partir de variables de entorno (ver .env.example).
 * Cada integración se activa sólo si están sus credenciales.
 */
import { buildPlatform, seedPlatform } from "../composition/platform";
import { PostHogProductAnalytics } from "../infrastructure/stats/StatsAdapters";
import { GoogleCloudTextToSpeech, ZendeskSupportDesk } from "../infrastructure/inclusion/InclusionAdapters";
import { seedCore } from "../composition/container";
import { demoSeed } from "../demo/seedData";
import type { IBackupSink, IDataStore, IEmailTransport, IHttpClient, IInboundMediaFetcher, IMessageSender, IOcr, ISpeechToText } from "../domain/ports";
import { ClaudeVisionOcr, GoogleVisionOcr } from "../infrastructure/inclusion/OcrAdapters";
import { OpenAiCompatibleSpeechToText, TelegramFileFetcher, WhatsAppMediaFetcher } from "../infrastructure/inclusion/SpeechAdapters";
import { profileFor, validateEnvironment } from "../composition/environment";
import { FileSystemBackupSink, S3BackupSink } from "../infrastructure/ops/BackupSinks";
import { RecordingEmailTransport, NodemailerSmtpTransport } from "../infrastructure/mail/MailAdapters";
import { TelegramBotSender, WhatsAppCloudSender } from "../infrastructure/messaging/ChannelAdapters";
import { createMemoryStore, createPostgresStore, createSqliteStore } from "../infrastructure/persistence/stores";
import { FetchHttpClient } from "../infrastructure/system/EventsAndHttp";
import { FakeInvoiceIssuer } from "../infrastructure/billing/Payments";
import { ConsoleLogger } from "../infrastructure/system/System";

const env = (k: string, def?: string) => process.env[k] ?? def;

export function storeFromEnv(): IDataStore {
  const url = env("DATABASE_URL");
  if (url?.startsWith("postgres")) return createPostgresStore(url);
  if (env("SQLITE_PATH")) return createSqliteStore(env("SQLITE_PATH"));
  return createMemoryStore();
}

/** Dónde se guardan las copias (disco o S3/R2/MinIO), si está configurado. */
export function backupSinkFromEnv(): IBackupSink | undefined {
  if (env("BACKUP_S3_BUCKET")) {
    return new S3BackupSink({
      bucket: env("BACKUP_S3_BUCKET")!, region: env("BACKUP_S3_REGION"), endpoint: env("BACKUP_S3_ENDPOINT"),
      accessKeyId: env("BACKUP_S3_ACCESS_KEY_ID") ?? "", secretAccessKey: env("BACKUP_S3_SECRET_ACCESS_KEY") ?? "", prefix: env("BACKUP_S3_PREFIX"),
    });
  }
  return env("BACKUP_DIR") ? new FileSystemBackupSink(env("BACKUP_DIR")!) : undefined;
}

/** Descarga de audios y capturas de los canales configurados. */
function mediaFetchersFromEnv(): IInboundMediaFetcher[] {
  const fetchers: IInboundMediaFetcher[] = [];
  if (env("WHATSAPP_TOKEN")) fetchers.push(new WhatsAppMediaFetcher({ accessToken: env("WHATSAPP_TOKEN")! }));
  if (env("TELEGRAM_BOT_TOKEN")) fetchers.push(new TelegramFileFetcher(env("TELEGRAM_BOT_TOKEN")!));
  return fetchers;
}

/** Notas de voz: transcriptor compatible con la API de OpenAI. */
function speechFromEnv(): ISpeechToText | undefined {
  if (!env("SPEECH_TO_TEXT_API_KEY")) return undefined;
  return new OpenAiCompatibleSpeechToText({ apiKey: env("SPEECH_TO_TEXT_API_KEY")!, baseUrl: env("SPEECH_TO_TEXT_BASE_URL") || undefined, model: env("SPEECH_TO_TEXT_MODEL") || undefined });
}

/** Capturas: OCR_PROVIDER=claude (usa ANTHROPIC_API_KEY) | google (GOOGLE_VISION_API_KEY). Sin elegir, el que tenga clave. */
function ocrFromEnv(http: IHttpClient): IOcr | undefined {
  const provider = env("OCR_PROVIDER") || (env("GOOGLE_VISION_API_KEY") ? "google" : env("ANTHROPIC_API_KEY") ? "claude" : "");
  if (provider === "google" && env("GOOGLE_VISION_API_KEY")) return new GoogleVisionOcr(http, { apiKey: env("GOOGLE_VISION_API_KEY")! });
  if (provider === "claude" && env("ANTHROPIC_API_KEY")) return new ClaudeVisionOcr({ apiKey: env("ANTHROPIC_API_KEY")!, model: env("OCR_MODEL") || undefined });
  return undefined;
}

export async function platformFromEnv() {
  const logger = new ConsoleLogger(env("LOG_VERBOSE") === "1");
  // Ambiente: si falta algo crítico, NO arranca.
  const profile = profileFor(env("APP_ENV") ?? env("NODE_ENV"));
  const problems = validateEnvironment(profile, process.env);
  if (problems.length) throw new Error(`Configuración inválida para ${profile.label}:\n- ${problems.join("\n- ")}`);
  const store = storeFromEnv();
  await store.migrate();
  await seedPlatform(store);
  if (env("LOAD_DEMO_DATA") === "1" && profile.allowDemoData) await seedCore(store, demoSeed);

  const http = new FetchHttpClient();
  const senders: IMessageSender[] = [];
  if (env("WHATSAPP_TOKEN") && env("WHATSAPP_PHONE_NUMBER_ID")) {
    senders.push(new WhatsAppCloudSender(http, { accessToken: env("WHATSAPP_TOKEN")!, phoneNumberId: env("WHATSAPP_PHONE_NUMBER_ID")! }));
  }
  if (env("TELEGRAM_BOT_TOKEN")) senders.push(new TelegramBotSender(http, env("TELEGRAM_BOT_TOKEN")!));

  const transport: IEmailTransport = env("SMTP_HOST")
    ? new NodemailerSmtpTransport({ host: env("SMTP_HOST")!, port: Number(env("SMTP_PORT", "587")), secure: env("SMTP_SECURE") === "true", user: env("SMTP_USER"), pass: env("SMTP_PASS") })
    : new RecordingEmailTransport();

  const vaultKey = env("VAULT_MASTER_KEY");
  if (!vaultKey) throw new Error("Falta VAULT_MASTER_KEY (clave para cifrar contraseñas y secretos).");

  const platform = buildPlatform({
    store,
    core: {
      ai: env("ANTHROPIC_API_KEY") ? { provider: "anthropic", apiKey: env("ANTHROPIC_API_KEY")!, model: env("ANTHROPIC_MODEL", "claude-sonnet-5")! } : { provider: "rules" },
      fetcher: "http",
      seed: { ...demoSeed, searchableArticles: env("LOAD_DEMO_DATA") === "1" ? demoSeed.searchableArticles : [], fetchableArticles: [] },
      logger,
    },
    publicBaseUrl: env("PUBLIC_BASE_URL", "http://localhost:8080")!,
    vaultMasterKey: vaultKey,
    invoicing: {
      // Para producción, reemplazar el emisor de prueba por uno de ARCA (WSAA + WSFEv1).
      issuer: new FakeInvoiceIssuer(),
      seller: {
        taxCondition: env("SELLER_TAX_CONDITION") === "monotributista" ? "monotributista" : "responsable_inscripto",
        pointOfSale: Number(env("SELLER_POINT_OF_SALE", "1")),
        vatRate: 0.21,
      },
    },
    stats: { pseudonymSecret: env("STATS_PSEUDONYM_SECRET"), minGroupSize: Number(env("STATS_MIN_GROUP_SIZE", "10")) },
    productAnalytics: env("POSTHOG_API_KEY")
      ? new PostHogProductAnalytics(http, { host: env("POSTHOG_HOST", "https://us.i.posthog.com")!, apiKey: env("POSTHOG_API_KEY")! }, logger)
      : undefined,
    environment: {
      name: profile.name,
      sandbox: profile.realRecipients ? undefined : { allowlist: (env("SANDBOX_RECIPIENTS", "") ?? "").split(",").map((x) => x.trim()).filter(Boolean), prefix: profile.messagePrefix ?? "[PRUEBA]" },
    },
    backups: backupSinkFromEnv() && env("BACKUP_PASSPHRASE")
      ? { sink: backupSinkFromEnv()!, passphrase: env("BACKUP_PASSPHRASE")!, scratch: () => createMemoryStore() }
      : undefined,
    tts: env("GOOGLE_TTS_API_KEY") ? new GoogleCloudTextToSpeech(http, { apiKey: env("GOOGLE_TTS_API_KEY")! }) : undefined,
    mediaFetchers: mediaFetchersFromEnv(),
    speech: speechFromEnv(),
    ocr: ocrFromEnv(http),
    supportDesk: env("ZENDESK_SUBDOMAIN")
      ? new ZendeskSupportDesk(http, { subdomain: env("ZENDESK_SUBDOMAIN")!, email: env("ZENDESK_EMAIL") ?? "", apiToken: env("ZENDESK_API_TOKEN") ?? "" })
      : undefined,
    oauth: env("GOOGLE_CLIENT_ID") ? { google: { clientId: env("GOOGLE_CLIENT_ID")!, clientSecret: env("GOOGLE_CLIENT_SECRET") ?? "" } } : undefined,
    http,
    senders,
    mail: {
      transport,
      from: env("MAIL_FROM", "Sin Humo <analizar@localhost>")!,
      trustedAuthServIds: (env("MAIL_TRUSTED_AUTHSERV_IDS", "") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    },
  });
  return { platform, store, logger };
}
