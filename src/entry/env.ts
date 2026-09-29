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
import { TesseractOcr, ClaudeVisionOcr, GoogleVisionOcr } from "../infrastructure/inclusion/OcrAdapters";
import type { EvidenceProviders } from "../application/evidence/Evidence";
import { SinkEvidenceBlobStore } from "../infrastructure/evidence/EvidenceStores";
import { Rfc3161TimestampAuthority, WaybackMachineArchive } from "../infrastructure/evidence/EvidenceAdapters";
import { HCaptcha, TurnstileCaptcha } from "../infrastructure/abuse/AbuseAdapters";
import { DISPOSABLE_EMAIL_DOMAINS } from "../config/abuse";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ISocialSource, ITranslator } from "../domain/ports";
import { OEmbedSocialSource, OpenGraphSocialSource, YouTubeDataApiSource } from "../infrastructure/social/SocialSources";
import { HttpPageCapturer } from "../infrastructure/evidence/HttpPageCapturer";
import { DeepLTranslator, GoogleTranslator, LLMTranslator } from "../infrastructure/language/LanguageAdapters";
import { SpotlightingLLMClient } from "../infrastructure/llm/SpotlightingLLMClient";
import { AnthropicLLMClient } from "../infrastructure/llm/AnthropicLLMClient";
import { OpenAiCompatibleSpeechToText, TelegramFileFetcher, WhatsAppMediaFetcher } from "../infrastructure/inclusion/SpeechAdapters";
import { profileFor, validateEnvironment } from "../composition/environment";
import { FileSystemBackupSink, S3BackupSink } from "../infrastructure/ops/BackupSinks";
import { ConsoleEmailTransport, RecordingEmailTransport, NodemailerSmtpTransport } from "../infrastructure/mail/MailAdapters";
import { TelegramBotSender, WhatsAppCloudSender } from "../infrastructure/messaging/ChannelAdapters";
import { createMemoryStore, createPostgresStore, createSqliteStore } from "../infrastructure/persistence/stores";
import { FetchHttpClient } from "../infrastructure/system/EventsAndHttp";
import { PublicDestinationHttpClient } from "../infrastructure/integrations/PublicDestinationHttpClient";
import { FakeInvoiceIssuer } from "../infrastructure/billing/Payments";
import { ConsoleLogger } from "../infrastructure/system/System";

/** Variable de entorno; vacía cuenta como no configurada (Docker Compose pasa "" cuando falta en .env). */
const env = (k: string, def?: string) => {
  const v = process.env[k];
  return v === undefined || v.trim() === "" ? def : v;
};

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
  // Local: el servicio "whisper" de docker-compose (whisper.cpp), con la misma API que OpenAI.
  if (env("SPEECH_TO_TEXT_PROVIDER") === "local") {
    return new OpenAiCompatibleSpeechToText({ id: "local-whisper", apiKey: "local", baseUrl: env("SPEECH_TO_TEXT_BASE_URL", "http://whisper:8080/v1"), model: "whisper-1" });
  }
  if (!env("SPEECH_TO_TEXT_API_KEY")) return undefined;
  return new OpenAiCompatibleSpeechToText({ apiKey: env("SPEECH_TO_TEXT_API_KEY")!, baseUrl: env("SPEECH_TO_TEXT_BASE_URL") || undefined, model: env("SPEECH_TO_TEXT_MODEL") || undefined });
}

/** Archivo de evidencias: dónde se guardan las copias, sello de tiempo y copia pública. */
function evidenceFromEnv(http: IHttpClient): Partial<EvidenceProviders> {
  const blobs = env("EVIDENCE_S3_BUCKET")
    ? new SinkEvidenceBlobStore(new S3BackupSink({
        bucket: env("EVIDENCE_S3_BUCKET")!, region: env("EVIDENCE_S3_REGION"), endpoint: env("EVIDENCE_S3_ENDPOINT"),
        accessKeyId: env("EVIDENCE_S3_ACCESS_KEY_ID") ?? "", secretAccessKey: env("EVIDENCE_S3_SECRET_ACCESS_KEY") ?? "", prefix: env("EVIDENCE_S3_PREFIX"),
      }))
    : env("EVIDENCE_DIR") ? new SinkEvidenceBlobStore(new FileSystemBackupSink(env("EVIDENCE_DIR")!)) : undefined;
  return {
    ...(blobs ? { blobs } : {}),
    timestamp: env("EVIDENCE_TSA_URL") ? new Rfc3161TimestampAuthority({ url: env("EVIDENCE_TSA_URL")! }) : undefined,
    archives: env("EVIDENCE_WAYBACK") === "1" ? [new WaybackMachineArchive(http, env("EVIDENCE_WAYBACK_AUTH") || undefined)] : [],
  };
}

/** Freno contra el abuso: captcha (Turnstile o hCaptcha) y lista ampliada de mails descartables. */
function abuseFromEnv() {
  const secret = env("CAPTCHA_SECRET");
  const captcha = secret ? (env("CAPTCHA_PROVIDER") === "hcaptcha" ? new HCaptcha(secret) : new TurnstileCaptcha(secret)) : undefined;
  const file = env("DISPOSABLE_EMAIL_DOMAINS_FILE");
  const extra = file ? readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#")) : [];
  return {
    captcha,
    captchaSiteKey: env("CAPTCHA_SITE_KEY") || undefined,
    ...(extra.length ? { disposableEmailDomains: [...DISPOSABLE_EMAIL_DOMAINS, ...extra] } : {}),
  };
}

/**
 * Redes: del más rico al más básico. oEmbed y metadatos públicos no necesitan claves;
 * la API de YouTube (YOUTUBE_API_KEY) suma descripción y números; Meta (META_OEMBED_TOKEN)
 * habilita Instagram y Facebook.
 */
function socialFromEnv(http: IHttpClient): { sources: ISocialSource[] } {
  return {
    sources: [
      ...(env("YOUTUBE_API_KEY") ? [new YouTubeDataApiSource(http, env("YOUTUBE_API_KEY")!)] : []),
      new OEmbedSocialSource(http, { metaAccessToken: env("META_OEMBED_TOKEN") || undefined }),
      new OpenGraphSocialSource(new HttpPageCapturer()),
    ],
  };
}

/**
 * Traducción: TRANSLATOR=deepl (DEEPL_API_KEY) | google (GOOGLE_TRANSLATE_API_KEY) | claude (ANTHROPIC_API_KEY).
 * Sin elegir, el que tenga clave. Con Claude, el costo se estima por caracteres como los demás.
 */
function translatorFromEnv(http: IHttpClient): ITranslator | undefined {
  const pick = env("TRANSLATOR") || (env("DEEPL_API_KEY") ? "deepl" : env("GOOGLE_TRANSLATE_API_KEY") ? "google" : "");
  if (pick === "deepl" && env("DEEPL_API_KEY")) return new DeepLTranslator(http, env("DEEPL_API_KEY")!);
  if (pick === "google" && env("GOOGLE_TRANSLATE_API_KEY")) return new GoogleTranslator(http, env("GOOGLE_TRANSLATE_API_KEY")!);
  if (pick === "claude" && env("ANTHROPIC_API_KEY")) {
    // El contenido a traducir es de terceros: viaja marcado como datos (spotlighting).
    return new LLMTranslator(new SpotlightingLLMClient(new AnthropicLLMClient({ apiKey: env("ANTHROPIC_API_KEY")!, model: env("TRANSLATOR_MODEL") || "claude-haiku-4-5" })));
  }
  return undefined;
}

/** Capturas: OCR_PROVIDER=claude (usa ANTHROPIC_API_KEY) | google (GOOGLE_VISION_API_KEY). Sin elegir, el que tenga clave. */
function ocrFromEnv(http: IHttpClient): IOcr | undefined {
  const provider = env("OCR_PROVIDER") || (env("GOOGLE_VISION_API_KEY") ? "google" : env("ANTHROPIC_API_KEY") ? "claude" : "");
  if (provider === "google" && env("GOOGLE_VISION_API_KEY")) return new GoogleVisionOcr(http, { apiKey: env("GOOGLE_VISION_API_KEY")! });
  if (provider === "claude" && env("ANTHROPIC_API_KEY")) return new ClaudeVisionOcr({ apiKey: env("ANTHROPIC_API_KEY")!, model: env("OCR_MODEL") || undefined });
  // Local (viene en la imagen de Docker): sin servicios externos ni costo por uso.
  if (provider === "tesseract") return new TesseractOcr({ binary: env("TESSERACT_BINARY") || undefined });
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
  await seedPlatform(store, { legalTexts: legalTexts() });
  if (env("LOAD_DEMO_DATA") === "1" && profile.allowDemoData) await seedCore(store, demoSeed);

  const http = new FetchHttpClient();
  const senders: IMessageSender[] = [];
  if (env("WHATSAPP_TOKEN") && env("WHATSAPP_PHONE_NUMBER_ID")) {
    senders.push(new WhatsAppCloudSender(http, { accessToken: env("WHATSAPP_TOKEN")!, phoneNumberId: env("WHATSAPP_PHONE_NUMBER_ID")! }));
  }
  if (env("TELEGRAM_BOT_TOKEN")) senders.push(new TelegramBotSender(http, env("TELEGRAM_BOT_TOKEN")!));

  const transport: IEmailTransport = env("SMTP_HOST")
    ? new NodemailerSmtpTransport({ host: env("SMTP_HOST")!, port: Number(env("SMTP_PORT", "587")), secure: env("SMTP_SECURE") === "true", user: env("SMTP_USER"), pass: env("SMTP_PASS") })
    : profile.name === "development"
      ? new ConsoleEmailTransport() // en desarrollo sin SMTP: los mails (y sus enlaces) van al log
      : new RecordingEmailTransport();

  const vaultKey = env("VAULT_MASTER_KEY");
  if (!vaultKey) throw new Error("Falta VAULT_MASTER_KEY (clave para cifrar contraseñas y secretos).");

  const platform = buildPlatform({
    store,
    core: {
      ai: env("ANTHROPIC_API_KEY") ? { provider: "anthropic", apiKey: env("ANTHROPIC_API_KEY")!, model: env("ANTHROPIC_MODEL", "claude-sonnet-5")! } : { provider: "rules" },
      promptSafety: { llmDetector: env("PROMPT_GUARD_LLM") === "1" },
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
    evidence: evidenceFromEnv(http),
    abuse: abuseFromEnv(),
    translator: translatorFromEnv(http),
    social: socialFromEnv(http),
    supportDesk: env("ZENDESK_SUBDOMAIN")
      ? new ZendeskSupportDesk(http, { subdomain: env("ZENDESK_SUBDOMAIN")!, email: env("ZENDESK_EMAIL") ?? "", apiToken: env("ZENDESK_API_TOKEN") ?? "" })
      : undefined,
    oauth: env("GOOGLE_CLIENT_ID") ? { google: { clientId: env("GOOGLE_CLIENT_ID")!, clientSecret: env("GOOGLE_CLIENT_SECRET") ?? "" } } : undefined,
    http,
    // Webhooks: el destino lo elige una persona → sólo direcciones públicas y sin seguir redirecciones.
    // En desarrollo se permite localhost para probarlos.
    chatLinks: { whatsappNumber: env("WHATSAPP_PUBLIC_NUMBER"), telegramBot: env("TELEGRAM_BOT_USERNAME") },
    setupFacts: {
      environment: { name: profile.name, production: profile.name === "production", problems: [] }, // (con problemas, no arranca)
      publicBaseUrl: env("PUBLIC_BASE_URL", "http://localhost:8080")!,
      mail: env("SMTP_HOST") ? "real" : "test",
      whatsapp: { configured: !!(env("WHATSAPP_TOKEN") && env("WHATSAPP_PHONE_NUMBER_ID")), publicNumber: !!env("WHATSAPP_PUBLIC_NUMBER") },
      telegram: { configured: !!env("TELEGRAM_BOT_TOKEN"), botUsername: !!env("TELEGRAM_BOT_USERNAME") },
      payments: "test", // (todavía no hay proveedor real integrado)
      invoicing: "test", // (ídem ARCA)
      backups: !!(backupSinkFromEnv() && env("BACKUP_PASSPHRASE")),
    },
    userDestinations: {
      http: new PublicDestinationHttpClient(new FetchHttpClient(15_000, { followRedirects: false }), { allowPrivate: profile.name === "development", allowHttp: true, maxRedirects: 5 }),
      allowPrivate: profile.name === "development",
    },
    webhooks: {
      http: new PublicDestinationHttpClient(new FetchHttpClient(10_000, { followRedirects: false }), { allowPrivate: profile.name === "development" }),
      allowLocal: profile.name === "development",
    },
    senders,
    mail: {
      transport,
      from: env("MAIL_FROM", "Sin Humo <analizar@localhost>")!,
      trustedAuthServIds: (env("MAIL_TRUSTED_AUTHSERV_IDS", "") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    },
  });
  return { platform, store, logger };
}

/** Texto completo de términos y privacidad (docs/legal, copiado en la imagen). Si falta, se publica sin texto. */
function legalTexts(): Partial<Record<"terms" | "privacy", string>> {
  const read = (file: string) => {
    try {
      return readFileSync(join(process.cwd(), "docs", "legal", file), "utf8");
    } catch {
      return undefined;
    }
  };
  return { terms: read("TERMINOS.md"), privacy: read("PRIVACIDAD.md") };
}
