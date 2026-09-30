import { randomUUID } from "node:crypto";
import type { MediaCheckService } from "../media/MediaCheck";
import type { ScreenshotResult } from "../inclusion/Screenshots";
import type { InboundMediaDownloader } from "../inclusion/InboundMedia";
import { ValidationError } from "../../domain/errors";
import type { Command, ContentItem, DeliveryResult, InboundMessage, ResponseContent, User } from "../../domain/model";
import type {
  ICommandParser,
  IConversationWindowRepository,
  IOptOutRepository,
  IOutletReader,
  IRequestContext,
  IRuleSetRepository,
  IUserRepository,
  IParameterStore,
  IPlainLanguageRewriter,
  IFeatureFlags,
} from "../../domain/ports";
import { billingSubjectOf } from "../access/AccessControl";
import type { AccessControl } from "../access/AccessControl";
import type { Caller, ProductGateway } from "../access/ProductGateway";
import type { RegisterUserUseCase } from "../users/RegisterUserUseCase";
import type { SaveRuleSetUseCase } from "../users/UserSettingsUseCases";
import type { NotificationService } from "./NotificationService";
import { FEEDBACK_ASK, type ResponseComposer } from "./ResponseComposer";
import type { PreferencesService } from "../config/Preferences";
import type { TaxonomyService } from "../config/Taxonomy";
import type { LearningService } from "../learning/Learning";
import type { SupportService } from "../support/Support";
import type { BrandingService, ReferralService } from "../commerce/Commerce";
import type { AudioReplyService } from "../inclusion/AudioReplies";
import type { LegalService } from "../legal/Legal";
import type { VoiceNoteService } from "../inclusion/VoiceNotes";
import type { ScreenshotService } from "../inclusion/Screenshots";
import type { EvidenceService } from "../evidence/Evidence";
import type { DigestService } from "../digest/Digests";
import type { IAbusePolicy } from "../abuse/AbuseGuard";
import type { ResponseLocalizer } from "../language/Translation";
import type { SocialReader } from "../social/SocialReader";
import type { NewsLinkReader } from "../content/NewsLinkReader";
import type { EventRoomService } from "../participation/EventRooms";
import type { LinkChannelUseCase } from "../users/UserSettingsUseCases";
import type { ILanguageDetector } from "../../domain/ports";
import { BASE_LANGUAGE, MIN_DETECTION_CONFIDENCE, SUPPORTED_LANGUAGES } from "../../config/languages";

const OPT_OUT_WORDS = ["baja", "stop", "cancelar avisos", "unsubscribe", "sair", "parar avisos"];
const OPT_IN_WORDS = ["alta", "start", "voltar"];
const YES_WORDS = ["si", "sí", "sí!", "si!", "me sirvio", "me sirvió", "sim", "yes"];
const NO_WORDS = ["no", "no me sirvio", "no me sirvió", "no!", "não", "nao"];

/** Quien recibe la respuesta a "¿Te sirvió?" (lo implementa FeedbackService). */
export interface IFeedbackSink {
  submitForLatest(userId: string, useful: boolean): Promise<unknown | undefined>;
}

/** Extras opcionales del chat (calidad, preferencias, temas, parámetros). */
export interface InboundExtras {
  feedback?: IFeedbackSink;
  preferences?: PreferencesService;
  taxonomy?: TaxonomyService;
  params?: IParameterStore;
  learning?: LearningService;
  support?: SupportService;
  referrals?: ReferralService;
  branding?: BrandingService;
  audio?: AudioReplyService;
  plainLanguage?: IPlainLanguageRewriter;
  flags?: IFeatureFlags;
  legal?: LegalService;
  voice?: VoiceNoteService;
  screenshots?: ScreenshotService;
  evidence?: EvidenceService;
  digests?: DigestService;
  abuse?: IAbusePolicy;
  /** Respuestas en el idioma de la persona. */
  localizer?: ResponseLocalizer;
  /** Para elegir el idioma de quien escribe por primera vez. */
  languageDetector?: ILanguageDetector;
  /** Links a redes: se lee la publicación. */
  social?: SocialReader;
  /** Links a notas: se lee la nota. */
  newsLinks?: NewsLinkReader;
  /** Eventos en vivo: suscribirse a sus chequeos. */
  events?: EventRoomService;
  /** Fotos y videos: si ya circularon y qué dicen sus datos (el archivo se baja una sola vez). */
  media?: { check: MediaCheckService; downloader: InboundMediaDownloader };
  /** "VINCULAR <código>": este chat pasa a ser de la cuenta que pidió el código en la web. */
  linkChannel?: Pick<LinkChannelUseCase, "linkFromChat">;
}

/** "VINCULAR ABCD2345" o, desde el enlace de Telegram, "/start ABCD2345". */
const LINK_COMMAND = /^\s*(?:\/start|vincular)\s+([A-Za-z0-9]{8})\s*$/i;
const LINK_ERRORS = {
  invalid: "Ese código no sirve o ya venció. Pedí uno nuevo desde la web (Mi cuenta) y mandalo de nuevo.",
  throttled: "Probaste muchos códigos seguidos. Esperá una hora y pedí uno nuevo desde la web.",
  taken: "Este chat ya está vinculado a otra cuenta de Sin Humo. Si querés unirlas, escribí /soporte.",
} as const;

/** Tope para bajar fotos y videos (WhatsApp: videos de hasta 16 MB; Telegram: 20 MB). */
const MEDIA_MAX_BYTES = 20 * 1024 * 1024;

const QUIZ_SMOKE = ["humo", "es humo", "tiene humo"];
const QUIZ_CLEAN = ["limpio", "no es humo", "no tiene humo", "sin humo"];

/**
 * Mensaje entrante por WhatsApp, Telegram, SMS... (ya normalizado por el parser del canal).
 *
 * REGLAS:
 *  - Quien escribe por primera vez queda registrado en el plan gratuito, con ese canal
 *    VERIFICADO: el mensaje llegó desde esa dirección, así que es suya.
 *  - Cada mensaje entrante abre/renueva la ventana de conversación (WhatsApp: 24 h).
 *  - "BAJA" → no se le envían más avisos (sí se le sigue respondiendo si pregunta).
 *  - Todo pedido pasa por el ProductGateway: mismas reglas que la web o la API.
 */
export class HandleInboundMessageUseCase {
  constructor(
    private readonly users: IUserRepository,
    private readonly register: RegisterUserUseCase,
    private readonly parser: ICommandParser,
    private readonly gateway: ProductGateway,
    private readonly access: AccessControl,
    private readonly saveRules: SaveRuleSetUseCase,
    private readonly ruleSets: IRuleSetRepository,
    private readonly outlets: IOutletReader,
    private readonly composer: ResponseComposer,
    private readonly notifications: NotificationService,
    private readonly windows: IConversationWindowRepository,
    private readonly optOuts: IOptOutRepository,
    /** Para atribuir el costo de la respuesta (mensaje saliente) al cliente. */
    private readonly context?: IRequestContext,
    private readonly extras: InboundExtras = {},
  ) {}

  async execute(msg: InboundMessage): Promise<{ user: User; response: ResponseContent; delivery: DeliveryResult }> {
    await this.windows.touch(msg.channel, msg.from, msg.receivedAt);
    // Vincular este chat a una cuenta de la web: antes de dar de alta a quien escribe (si no, el número quedaría tomado).
    const linkCode = this.extras.linkChannel ? msg.text?.match(LINK_COMMAND)?.[1] : undefined;
    let linkError: string | undefined;
    if (linkCode) {
      const r = await this.extras.linkChannel!.linkFromChat({ channel: msg.channel, address: msg.from, code: linkCode });
      if (r.ok) {
        const response = this.composer.info(
          r.already ? "Este chat ya estaba vinculado a tu cuenta." : "Listo: este chat quedó vinculado a tu cuenta de Sin Humo.",
          "Desde ahora podés usar Sin Humo por acá, con tu plan y tus preferencias. Mandame un mensaje o una nota para analizar.",
        );
        const delivery = await this.notifications.sendTo(msg.channel, msg.from, response, "reply", { replyTo: { externalId: msg.externalId } });
        return { user: r.user, response, delivery };
      }
      linkError = LINK_ERRORS[r.reason];
    }
    const existing = await this.users.findByChannel(msg.channel, msg.from);
    if (existing && existing.status !== "active") {
      // Cuenta suspendida: no se analiza nada (tampoco se cobra); sólo se avisa.
      const response = this.composer.info("Tu cuenta está suspendida.", "Si creés que es un error, escribinos desde la web (Ayuda).");
      const delivery = await this.notifications.sendTo(msg.channel, msg.from, response, "reply", { replyTo: { externalId: msg.externalId } });
      return { user: existing, response, delivery };
    }
    const user = existing ?? (await this.register.execute({ name: msg.displayName ?? "Usuario", channel: { type: msg.channel, address: msg.from, verified: true } }));
    if (!existing) await this.guessLanguage(user, msg.text);

    const handle = async () => {
      let response = linkError ? this.composer.info("No pude vincular este chat.", linkError) : await this.respond(user, msg);
      if (this.extras.legal) response = await this.extras.legal.withNotice(response, user, msg.channel);
      const delivery = await this.notifications.sendTo(msg.channel, msg.from, response, "reply", { replyTo: { externalId: msg.externalId } });
      return { user, response, delivery };
    };
    const info = { userId: user.id, subjectId: billingSubjectOf(user).id, action: "inbound_message" };
    return this.context ? this.context.run(info, handle) : handle();
  }

  private async respond(user: User, msg: InboundMessage): Promise<ResponseContent> {
    if (!msg.audio && !msg.image && !msg.video) return this.respondText(user, msg);
    // Transcribir y leer imágenes se paga por uso: tope por hora contra el abuso.
    if (this.extras.abuse && (await this.extras.abuse.check({ action: "expensive", at: msg.receivedAt, userId: user.id })).outcome !== "allow") {
      return this.composer.info("Llegaste al máximo de audios e imágenes por ahora.", "Probá de nuevo en un rato o mandame el texto.");
    }
    if (msg.video) return this.respondVideo(user, msg);
    if (msg.image && this.extras.media?.downloader.supports(msg.channel)) return this.respondImage(user, msg);
    const from = msg.audio ? "voice" : "image";
    const extracted = from === "voice" ? await this.listen(user, msg) : await this.look(user, msg);
    if (typeof extracted !== "string") return extracted;
    // El epígrafe (si lo hay) va primero: puede traer un comando ("/fuentes …").
    const caption = msg.text.trim();
    const r = await this.respondText(user, { ...msg, text: caption ? `${caption}\n${extracted}` : extracted, extractedFrom: from });
    // Primero, lo que se entendió: así la persona puede ver si se leyó bien.
    const quote = extracted.length > 400 ? `${extracted.slice(0, 399)}…` : extracted;
    const heading = from === "voice" ? "🎙️ Lo que entendí del audio" : "🖼️ Lo que leí en la imagen";
    return { ...r, sections: [{ heading, lines: [`“${quote}”`] }, ...r.sections] };
  }

  /**
   * FOTO: se baja una vez; se revisa (¿ya circuló?, ¿qué dicen sus datos?) y, si tiene texto, se lee
   * y se analiza como cualquier mensaje. Una foto sin texto igual recibe la revisión.
   * En capturas con texto, la revisión sólo aparece si tiene algo para decir (no repetir "sin datos").
   */
  private async respondImage(user: User, msg: InboundMessage): Promise<ResponseContent> {
    const file = await this.downloadMedia(msg.channel, msg.image!.ref, msg.image!.mime);
    if (!file) return this.composer.info("No pude leer la imagen.", "Probá de nuevo en un rato o mandame el texto.");
    const report = await this.checkMedia(user, file, msg.channel);
    const caption = msg.text.trim();
    const screenshots = this.extras.screenshots;
    const state = screenshots ? await this.enabled(user, "screenshots") : "off";
    let read: ScreenshotResult | undefined;
    if (screenshots && state === "ok") read = await screenshots.readFile(file, await this.language(user));

    if (read?.ok) {
      const r = await this.respondText(user, { ...msg, text: caption ? `${caption}
${read.text}` : read.text, extractedFrom: "image" });
      const quote = read.text.length > 400 ? `${read.text.slice(0, 399)}…` : read.text;
      return { ...r, sections: [{ heading: "🖼️ Lo que leí en la imagen", lines: [`“${quote}”`] }, ...(report?.notable ? [report.section] : []), ...r.sections] };
    }
    // Sin texto leído: la revisión es lo que hay para decir (y el epígrafe, si lo hay, se analiza).
    const notice =
      !screenshots || state === "off" ? this.composer.info("Todavía no puedo leer imágenes.", "Mandame el texto y lo analizo.")
      : state === "plan" ? this.composer.info("Tu plan no incluye la lectura de capturas.", "Mandame el texto y lo analizo.")
      : read?.reason === "no_text" ? this.composer.info("No encontré texto para analizar en la imagen.", "Por ahora leo capturas con texto (mensajes, publicaciones, notas). Si querés, escribime lo que dice.")
      : this.composer.info("No pude leer la imagen.", "Probá de nuevo en un rato o mandame el texto.");
    if (!report) return notice;
    const base = caption ? await this.respondText(user, { ...msg, text: caption }) : notice;
    return { ...base, sections: [report.section, ...base.sections] };
  }

  /** VIDEO: no se transcribe; se revisa si ya circuló y qué dice el archivo. El epígrafe se analiza. */
  private async respondVideo(user: User, msg: InboundMessage): Promise<ResponseContent> {
    const file = this.extras.media ? await this.downloadMedia(msg.channel, msg.video!.ref, msg.video!.mime) : undefined;
    const report = file ? await this.checkMedia(user, file, msg.channel) : undefined;
    const caption = msg.text.trim();
    if (!report) return caption ? this.respondText(user, { ...msg, text: caption }) : this.composer.info("No pude revisar el video.", "Si es pesado (más de 20 MB), mandame el link de dónde lo viste.");
    const base = caption ? await this.respondText(user, { ...msg, text: caption }) : { ...this.composer.info("🔎 Revisé el video"), summary: report.section.lines[0] };
    return { ...base, sections: [report.section, ...base.sections] };
  }

  private async downloadMedia(channel: InboundMessage["channel"], ref: string, mime?: string): Promise<{ data: Buffer; mime: string } | undefined> {
    const d = this.extras.media?.downloader;
    if (!d?.supports(channel)) return undefined;
    try {
      const f = await d.download(channel, ref, MEDIA_MAX_BYTES);
      return f && { data: f.data, mime: mime ?? f.mime };
    } catch {
      return undefined;
    }
  }

  /** La revisión en una sección de la respuesta (o nada, si está apagada o no se pudo). */
  private async checkMedia(user: User, file: { data: Buffer; mime: string }, channel: string): Promise<{ section: { heading: string; lines: string[] }; notable: boolean } | undefined> {
    const media = this.extras.media;
    if (!media) return undefined;
    if (this.extras.flags) {
      const { plan } = await this.access.planOf(user);
      if (!(await this.extras.flags.isEnabled("media_check", { userId: user.id, organizationId: user.organizationId, planId: plan.id, country: user.country }))) return undefined;
    }
    try {
      const r = await media.check.check(file, { channel });
      const heading = r.kind === "image" ? "🔎 Sobre la imagen" : "🔎 Sobre el video";
      return {
        section: { heading, lines: [r.summary, ...r.signals.map((s) => `${s.level === "warning" ? "⚠️" : "ℹ️"} ${s.label}: ${s.detail}`)] },
        notable: r.signals.some((s) => s.id !== "no_metadata"),
      };
    } catch {
      return undefined;
    }
  }

  /** ¿Está habilitada esta función para la persona? (plan + función en prueba) */
  private async enabled(user: User, key: "voice_notes" | "screenshots"): Promise<"ok" | "off" | "plan"> {
    const { plan } = await this.access.planOf(user);
    const flagOn = this.extras.flags ? await this.extras.flags.isEnabled(key, { userId: user.id, organizationId: user.organizationId, planId: plan.id, country: user.country }) : true;
    if (!flagOn) return "off";
    return plan.features.includes(key) ? "ok" : "plan";
  }

  private async language(user: User): Promise<string> {
    return this.extras.preferences ? (await this.extras.preferences.effective(user)).language : "es";
  }

  /** Lee el texto de la captura. Devuelve el texto o, si no se puede, la respuesta para la persona. */
  private async look(user: User, msg: InboundMessage): Promise<string | ResponseContent> {
    const screenshots = this.extras.screenshots;
    const state = screenshots ? await this.enabled(user, "screenshots") : "off";
    if (!screenshots || state === "off") return this.composer.info("Todavía no puedo leer imágenes.", "Mandame el texto y lo analizo.");
    if (state === "plan") return this.composer.info("Tu plan no incluye la lectura de capturas.", "Mandame el texto y lo analizo.");
    const r = await screenshots.read(msg, await this.language(user));
    if (r.ok) return r.text;
    return r.reason === "no_text"
      ? this.composer.info("No encontré texto para analizar en la imagen.", "Por ahora leo capturas con texto (mensajes, publicaciones, notas). Si querés, escribime lo que dice.")
      : this.composer.info("No pude leer la imagen.", "Probá de nuevo en un rato o mandame el texto.");
  }

  /** Transcribe la nota de voz. Devuelve el texto o, si no se puede, la respuesta para la persona. */
  private async listen(user: User, msg: InboundMessage): Promise<string | ResponseContent> {
    const voice = this.extras.voice;
    const state = voice ? await this.enabled(user, "voice_notes") : "off";
    if (!voice || state === "off") return this.composer.info("Todavía no puedo escuchar audios.", "Mandame el texto y lo analizo.");
    if (state === "plan") return this.composer.info("Tu plan no incluye notas de voz.", "Mandame el texto y lo analizo.");
    const r = await voice.transcribe(msg, await this.language(user));
    if (r.ok) return r.text;
    const minutes = r.maxSeconds >= 120 ? `${Math.floor(r.maxSeconds / 60)} minutos` : `${r.maxSeconds} segundos`;
    switch (r.reason) {
      case "too_long":
        return this.composer.info(`El audio es muy largo: puedo escuchar hasta ${minutes}.`, "Mandame un audio más corto o el texto.");
      case "empty":
        return this.composer.info("No escuché nada en el audio.", "¿Lo podés mandar de nuevo o escribirlo?");
      default:
        return this.composer.info("No pude escuchar el audio.", "Probá de nuevo en un rato o mandame el texto.");
    }
  }

  private async respondText(user: User, msg: InboundMessage): Promise<ResponseContent> {
    const text = msg.text.trim().toLowerCase();
    if (OPT_OUT_WORDS.includes(text)) {
      await this.optOuts.save({ channel: msg.channel, address: msg.from, at: msg.receivedAt, reason: "pedido del usuario" });
      return this.composer.info("Listo, no vas a recibir más avisos.", "Si nos escribís, te seguimos respondiendo. Para volver a recibir avisos, escribí ALTA.");
    }
    if (OPT_IN_WORDS.includes(text)) {
      await this.optOuts.remove(msg.channel, msg.from);
      return this.composer.info("Listo, vas a volver a recibir tus avisos.");
    }

    // Juego pendiente: "HUMO" / "LIMPIO" responden la pregunta.
    if (this.extras.learning && (QUIZ_SMOKE.includes(text) || QUIZ_CLEAN.includes(text)) && (await this.extras.learning.hasPending(user.id))) {
      const r = await this.extras.learning.answer(user.id, QUIZ_SMOKE.includes(text));
      return this.personalize({
        kind: "info",
        title: r.correct ? `¡Bien! Era ${r.wasSmoke ? "humo" : "información limpia"}.` : `Casi: era ${r.wasSmoke ? "humo" : "información limpia"}.`,
        summary: r.explanation,
        sections: [{ lines: [`Racha: ${r.streak} · Aciertos: ${r.score.correct}/${r.score.answered} · Nivel: ${r.score.level}`, "Escribí /jugar para otra."] }],
        links: [],
      }, user);
    }
    const feedback = this.extras.feedback;
    if (feedback && (YES_WORDS.includes(text) || NO_WORDS.includes(text))) {
      const useful = YES_WORDS.includes(text);
      if (await feedback.submitForLatest(user.id, useful)) {
        return useful
          ? this.composer.info("¡Gracias! Nos ayuda a saber que vamos bien.")
          : this.composer.info("Gracias por avisar. El equipo va a revisar ese análisis para mejorar el algoritmo.", "Si querés, contanos qué estuvo mal en un mensaje.");
      }
    }

    const caller: Caller = { userId: user.id, channel: msg.channel };
    try {
      const response = await this.run(this.parser.parse(msg.text), caller, user, msg);
      return await this.personalize(response, user);
    } catch (err) {
      return this.composer.error(err);
    }
  }

  /**
   * Personalización de cada respuesta: pregunta de calidad (parámetro), formato elegido,
   * lectura fácil, audio (plan + preferencia + función habilitada) y marca de la organización.
   */
  private async personalize(r: ResponseContent, user: User): Promise<ResponseContent> {
    let out = r;
    if (this.extras.params && !(await this.extras.params.boolean("chat.show_feedback_question")) && out.footer?.includes(FEEDBACK_ASK)) {
      out = { ...out, footer: out.footer.replace(FEEDBACK_ASK, "").trim() || undefined };
    }
    const prefs = this.extras.preferences ? await this.extras.preferences.effective(user) : undefined;
    if (prefs) {
      out = this.composer.format(out, prefs.responseFormat);
      if (prefs.responseFormat === "easy_read" && this.extras.plainLanguage && out.kind === "result") out = await this.extras.plainLanguage.rewrite(out);
    }
    // Idioma de la persona: se traduce la respuesta ya armada (antes del audio, que la lee).
    if (prefs && prefs.language !== BASE_LANGUAGE && this.extras.localizer) out = await this.extras.localizer.localize(out, prefs.language);
    if (prefs?.audioReplies && this.extras.audio && out.kind !== "error") {
      const { plan } = await this.access.planOf(user);
      const flagOn = this.extras.flags ? await this.extras.flags.isEnabled("audio_replies", { userId: user.id, organizationId: user.organizationId, planId: plan.id, country: user.country }) : true;
      if (plan.features.includes("audio_replies") && flagOn) {
        try {
          out = await this.extras.audio.attach(out, prefs.language);
        } catch {
          /* sin audio: el texto igual llega */
        }
      }
    }
    const brand = await this.extras.branding?.markFor(user);
    return brand ? { ...out, brand } : out;
  }

  private async run(cmd: Command, caller: Caller, user: User, msg: InboundMessage): Promise<ResponseContent> {
    switch (cmd.type) {
      case "help":
        return this.composer.help();
      case "analyze_content": {
        // Un link a una red: se analiza lo que dice la publicación, no el link.
        const social = this.extras.social;
        const shared = social ? await social.readShared(cmd.text, { userId: user.id, organizationId: user.organizationId, country: user.country }) : undefined;
        if (social && shared?.post) {
          const r = this.composer.content(await this.gateway.analyzeContent(caller, social.contentFor(shared.post, this.toContent(cmd.text, msg))));
          return { ...r, sections: [social.describe(shared.post), ...r.sections] };
        }
        // Un link a una nota: se analiza la nota, no el link.
        const news = !shared && this.extras.newsLinks ? await this.extras.newsLinks.readShared(cmd.text) : undefined;
        if (news?.article && this.extras.newsLinks) {
          const r = this.composer.content(await this.gateway.analyzeContent(caller, this.extras.newsLinks.contentFor(news.article, this.toContent(cmd.text, msg))));
          return { ...r, sections: [this.extras.newsLinks.describe(news.article), ...r.sections] };
        }
        const r = this.composer.content(await this.gateway.analyzeContent(caller, this.toContent(cmd.text, msg)));
        if (news?.failed) return { ...r, sections: [{ heading: "📰 No pude leer la nota", lines: [`${news.failed} Analicé sólo tu mensaje: si podés, pegá el texto de la nota.`] }, ...r.sections] };
        return shared?.failed ? { ...r, sections: [{ heading: "📱 No pude leer la publicación", lines: ["Analicé sólo tu mensaje. Si podés, copiá el texto del posteo."] }, ...r.sections] } : r;
      }
      case "compare_sources": {
        const period = monthPeriod(cmd.month, msg.receivedAt);
        return this.composer.comparison(
          await this.gateway.compareSources(caller, { topic: cmd.topic, period, urlRules: { include: cmd.includeUrls } }),
        );
      }
      case "credibility": {
        const outlets = await this.outlets.findAll();
        const q = cmd.outlet.toLowerCase();
        const outlet = outlets.find((o) => o.id === q || o.name.toLowerCase().includes(q));
        if (!outlet) throw new ValidationError(`No encontré el medio "${cmd.outlet}".`);
        const to = msg.receivedAt;
        const from = new Date(to.getTime() - 365 * 86_400_000);
        return this.composer.credibility(await this.gateway.evaluateCredibility(caller, { outletId: outlet.id, topic: cmd.topic, period: { from, to } }));
      }
      case "exclude_site":
        await this.saveRules.execute({ actorId: user.id, scope: "user", name: `Excluir ${cmd.pattern}`, urlRules: { exclude: [cmd.pattern] } });
        return this.composer.info(`Listo: no voy a usar ${cmd.pattern} en tus comparaciones.`);
      case "list_rules": {
        const owners = user.organizationId ? [{ type: "user" as const, id: user.id }, { type: "organization" as const, id: user.organizationId }] : [{ type: "user" as const, id: user.id }];
        return this.composer.rules(await this.ruleSets.findActiveFor(owners));
      }
      case "my_plan": {
        const { plan } = await this.access.planOf(user);
        return this.composer.plan(plan, await this.access.usageOf(user));
      }
      case "follow_topic": {
        const t = await this.prefs().follow(user.id, cmd.topic);
        return this.composer.info(`Listo: seguís "${t.name}".`, "Te voy a avisar las novedades de este tema (según tus alertas y tu resumen).");
      }
      case "unfollow_topic": {
        const t = await this.prefs().unfollow(user.id, cmd.topic);
        return this.composer.info(`Dejaste de seguir "${t.name}".`);
      }
      case "list_topics": {
        const tree = await this.taxonomy().tree();
        const flat: { path: string; topics: { name: string; synonyms: string[] }[] }[] = [];
        const walk = (nodes: typeof tree) => nodes.forEach((n) => (flat.push({ path: n.path, topics: n.topics }), walk(n.children)));
        walk(tree);
        const followedIds = (await this.prefs().effective(user)).followedTopics;
        const names = (await this.taxonomy().topics()).filter((t) => followedIds.includes(t.id)).map((t) => t.name);
        return this.composer.topics(flat, names);
      }
      case "set_format":
        await this.prefs().update({ actorId: user.id, values: { responseFormat: cmd.format } });
        return this.composer.info(`Listo: formato ${{ short: "corto", detailed: "detallado", easy_read: "de lectura fácil" }[cmd.format]}.`);
      case "quiet_hours":
        await this.prefs().update({ actorId: user.id, values: { quietHours: cmd.from && cmd.to ? { from: cmd.from, to: cmd.to, utcOffsetMinutes: -180 } : null } });
        return this.composer.info(cmd.from ? `Listo: sin avisos de ${cmd.from} a ${cmd.to}. Si llega algo, te lo mando después.` : "Listo: sin horario de silencio.");
      case "audio_replies": {
        await this.prefs().update({ actorId: user.id, values: { audioReplies: cmd.on } });
        const { plan } = await this.access.planOf(user);
        const note = cmd.on && !plan.features.includes("audio_replies") ? "Las respuestas en audio vienen con el plan Personal o superior." : undefined;
        return this.composer.info(cmd.on ? "Listo: además del texto, te mando la respuesta en audio." : "Listo: sin audio.", note);
      }
      case "quiz_next": {
        const q = await this.need(this.extras.learning, "El juego").next(user.id);
        return { kind: "info", title: "¿Esto es humo?", summary: `“${q.text}”`, sections: [{ lines: ["Respondé HUMO o LIMPIO."] }], links: [] };
      }
      case "quiz_answer": {
        const r = await this.need(this.extras.learning, "El juego").answer(user.id, cmd.isSmoke);
        return this.composer.info(r.correct ? "¡Bien!" : "Casi.", r.explanation);
      }
      case "quiz_progress": {
        const p = await this.need(this.extras.learning, "El juego").progress(user.id);
        return this.composer.info(`Nivel: ${p.level}`, `Respondiste ${p.answered}, acertaste ${p.correct}. Mejor racha: ${p.bestStreak}.`);
      }
      case "join_classroom": {
        const c = await this.need(this.extras.learning, "Las aulas").join({ userId: user.id, code: cmd.code, alias: cmd.alias });
        return this.composer.info(`Entraste al aula "${c.name}" como ${cmd.alias}.`, "Tu docente sólo ve tu apodo y tus aciertos. Escribí /jugar para empezar.");
      }
      case "invite": {
        const s = await this.need(this.extras.referrals, "Las invitaciones").summary(user.id);
        return this.composer.info(`Tu código: ${s.code}`, `Quien se suma con tu código tiene un descuento en su primer pago, y cuando paga vos ganás un mes gratis. Invitaste a ${s.invited} (${s.rewarded} con premio).`);
      }
      case "referral_code": {
        const r = await this.need(this.extras.referrals, "Las invitaciones").apply({ userId: user.id, code: cmd.code });
        return this.composer.info("¡Bienvenida/o!", `Tenés ${r.percent}% de descuento en tu primer pago con el cupón ${r.welcomeCoupon}.`);
      }
      case "support": {
        const S = this.need(this.extras.support, "El soporte");
        const open = await S.latestOpen(user.id);
        const t = open ? await S.addFromRequester({ userId: user.id, ticketId: open.id, text: cmd.text }) : await S.open({ userId: user.id, text: cmd.text, channel: msg.channel });
        return this.composer.info(open ? `Sumamos tu mensaje al ticket ${t.id}.` : `Abrimos el ticket ${t.id}.`, `Te respondemos por acá antes de ${t.firstResponseDueAt.toISOString().slice(0, 16).replace("T", " ")} UTC.`);
      }
      case "support_list": {
        const list = await this.need(this.extras.support, "El soporte").listMine(user.id);
        return { kind: "info", title: "Tus tickets", summary: list.length ? undefined : "No tenés tickets. Escribí /soporte y tu consulta.", sections: list.slice(0, 5).map((t) => ({ heading: `${t.id} · ${t.status}`, lines: [t.subject] })), links: [] };
      }
      case "set_language": {
        const names = SUPPORTED_LANGUAGES.map((l) => `${l.code} (${l.name})`).join(", ");
        const lang = SUPPORTED_LANGUAGES.find((l) => l.code === cmd.language || l.name.toLowerCase() === cmd.language);
        if (!lang) return this.composer.info("¿En qué idioma te respondo?", `Escribí /idioma y uno de estos: ${names}.`);
        if (lang.code !== BASE_LANGUAGE && !this.extras.localizer) return this.composer.info("Por ahora respondo sólo en castellano.");
        await this.prefs().update({ actorId: user.id, values: { language: lang.code } });
        return this.composer.info(`Listo: te respondo en ${lang.name}.`);
      }
      case "event_list": {
        const list = (await this.need(this.extras.events, "Los eventos").list(5)).filter((e) => e.status !== "closed");
        if (list.length === 0) return this.composer.info("No hay eventos en vivo ni programados.");
        const when = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
        return {
          kind: "info",
          title: "Eventos en vivo",
          sections: list.map((e) => ({ heading: `${e.status === "live" ? "🔴 En vivo" : "🗓️ Próximo"} · ${e.title}`, lines: [`Organiza: ${e.host} · ${e.status === "live" ? `termina ${when(e.endsAt)}` : `empieza ${when(e.startsAt)}`}`, `Para recibir los chequeos por acá: /evento ${e.code}`] })),
          links: [],
        };
      }
      case "event_follow": {
        const E = this.need(this.extras.events, "Los eventos");
        if (!cmd.code) throw new ValidationError("Mandame /evento y el código del evento (lo ves con /eventos).");
        if (!cmd.on) {
          await E.unsubscribe({ userId: user.id, code: cmd.code });
          return this.composer.info("Listo: no te mando más chequeos de ese evento.");
        }
        const room = await E.subscribe({ userId: user.id, code: cmd.code });
        return this.composer.info(`Listo: te mando los chequeos de «${room.event!.title}».`, `Cuando el equipo verifique algo en vivo, te llega por acá. Para dejar de recibirlos: /evento no ${room.event!.code}`);
      }
      case "digest_now":
        return this.need(this.extras.digests, "El resumen").preview(user);
      case "digest_set": {
        await this.prefs().update({ actorId: user.id, values: { digest: cmd.frequency } });
        if (cmd.frequency === "off") return this.composer.info("Listo: sin resumen.");
        const { plan } = await this.access.planOf(user);
        const weeklyOnly = cmd.frequency === "daily" && !plan.features.includes("daily_digest");
        return this.composer.info(
          weeklyOnly ? "Listo: te mando el resumen semanal." : `Listo: te mando un resumen ${cmd.frequency === "daily" ? "todos los días" : "cada semana"}.`,
          weeklyOnly ? "El resumen diario viene con el plan Personal o superior." : "Escribí /resumen para ver tus novedades ahora.",
        );
      }
      case "archive_url": {
        const E = this.need(this.extras.evidence, "El archivo de evidencias");
        if (!cmd.url) throw new ValidationError("Mandame /guardar y el link de la nota (y \"seguir\" si querés que la vigile).");
        return this.composer.evidence((await E.capture({ actorId: user.id, url: cmd.url, monitor: cmd.monitor })).snapshot);
      }
      case "my_preferences": {
        const p = await this.prefs().effective(user);
        const names = (await this.taxonomy().topics()).filter((t) => p.followedTopics.includes(t.id)).map((t) => t.name);
        return this.composer.preferences(p, names);
      }
    }
  }

  /** Quien escribe por primera vez en otro idioma recibe las respuestas en ese idioma (lo puede cambiar con /idioma). */
  private async guessLanguage(user: User, text: string): Promise<void> {
    if (!this.extras.languageDetector || !this.extras.localizer || !this.extras.preferences || !text.trim()) return;
    const d = await this.extras.languageDetector.detect(text);
    if (d.language === BASE_LANGUAGE || d.confidence < MIN_DETECTION_CONFIDENCE || !SUPPORTED_LANGUAGES.some((l) => l.code === d.language)) return;
    await this.extras.preferences.update({ actorId: user.id, values: { language: d.language } });
  }

  private need<T>(x: T | undefined, what: string): T {
    if (!x) throw new ValidationError(`${what} no está disponible en este canal.`);
    return x;
  }

  private prefs(): PreferencesService {
    if (!this.extras.preferences) throw new ValidationError("Las preferencias no están disponibles en este canal.");
    return this.extras.preferences;
  }

  private taxonomy(): TaxonomyService {
    if (!this.extras.taxonomy) throw new ValidationError("Los temas no están disponibles en este canal.");
    return this.extras.taxonomy;
  }

  private toContent(text: string, msg: InboundMessage): ContentItem {
    return {
      id: randomUUID(),
      sourceType: "message",
      origin: { address: msg.from, name: msg.displayName },
      text,
      urls: text.match(/https?:\/\/[^\s)]+/g) ?? [],
      publishedAt: msg.receivedAt,
      receivedAt: msg.receivedAt,
      attachments: [],
      metadata: { channel: msg.channel, ...(msg.forwardedManyTimes ? { "forwarded-many-times": "true" } : {}), ...(msg.extractedFrom ? { "extracted-from": msg.extractedFrom } : {}) },
      forwardedFrom: msg.forwarded ? {} : undefined,
    };
  }
}

function monthPeriod(month: string | undefined, now: Date) {
  if (month) {
    const [y, m] = month.split("-").map(Number) as [number, number];
    return { from: new Date(Date.UTC(y, m - 1, 1, 3)), to: new Date(Date.UTC(y, m, 1, 2, 59, 59)) };
  }
  return { from: new Date(now.getTime() - 30 * 86_400_000), to: now };
}
