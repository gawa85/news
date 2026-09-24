import { randomUUID } from "node:crypto";
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

const OPT_OUT_WORDS = ["baja", "stop", "cancelar avisos", "unsubscribe"];
const OPT_IN_WORDS = ["alta", "start"];
const YES_WORDS = ["si", "sí", "sí!", "si!", "me sirvio", "me sirvió"];
const NO_WORDS = ["no", "no me sirvio", "no me sirvió", "no!"];

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
}

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
    const user =
      (await this.users.findByChannel(msg.channel, msg.from)) ??
      (await this.register.execute({ name: msg.displayName ?? "Usuario", channel: { type: msg.channel, address: msg.from, verified: true } }));

    const handle = async () => {
      let response = await this.respond(user, msg);
      if (this.extras.legal) response = await this.extras.legal.withNotice(response, user, msg.channel);
      const delivery = await this.notifications.sendTo(msg.channel, msg.from, response, "reply", { replyTo: { externalId: msg.externalId } });
      return { user, response, delivery };
    };
    const info = { userId: user.id, subjectId: billingSubjectOf(user).id, action: "inbound_message" };
    return this.context ? this.context.run(info, handle) : handle();
  }

  private async respond(user: User, msg: InboundMessage): Promise<ResponseContent> {
    if (!msg.audio) return this.respondText(user, msg);
    const heard = await this.listen(user, msg);
    if (typeof heard !== "string") return heard;
    // El epígrafe (si lo hay) va primero: puede traer un comando ("/fuentes …").
    const caption = msg.text.trim();
    const r = await this.respondText(user, { ...msg, text: caption ? `${caption}\n${heard}` : heard, transcribed: true });
    // Primero, lo que se entendió: así la persona puede ver si la transcripción está bien.
    const quote = heard.length > 400 ? `${heard.slice(0, 399)}…` : heard;
    return { ...r, sections: [{ heading: "🎙️ Lo que entendí del audio", lines: [`“${quote}”`] }, ...r.sections] };
  }

  /** Transcribe la nota de voz. Devuelve el texto o, si no se puede, la respuesta para la persona. */
  private async listen(user: User, msg: InboundMessage): Promise<string | ResponseContent> {
    const voice = this.extras.voice;
    const { plan } = await this.access.planOf(user);
    const flagOn = this.extras.flags ? await this.extras.flags.isEnabled("voice_notes", { userId: user.id, organizationId: user.organizationId, planId: plan.id, country: user.country }) : true;
    if (!voice || !flagOn) return this.composer.info("Todavía no puedo escuchar audios.", "Mandame el texto y lo analizo.");
    if (!plan.features.includes("voice_notes")) return this.composer.info("Tu plan no incluye notas de voz.", "Mandame el texto y lo analizo.");
    const language = this.extras.preferences ? (await this.extras.preferences.effective(user)).language : "es";
    const r = await voice.transcribe(msg, language);
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
      case "analyze_content":
        return this.composer.content(await this.gateway.analyzeContent(caller, this.toContent(cmd.text, msg)));
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
      case "my_preferences": {
        const p = await this.prefs().effective(user);
        const names = (await this.taxonomy().topics()).filter((t) => p.followedTopics.includes(t.id)).map((t) => t.name);
        return this.composer.preferences(p, names);
      }
    }
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
      metadata: { channel: msg.channel, ...(msg.forwardedManyTimes ? { "forwarded-many-times": "true" } : {}), ...(msg.transcribed ? { "voice-note": "true" } : {}) },
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
