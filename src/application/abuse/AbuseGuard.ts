import { AbuseRejectedError, AccessDeniedError, NotFoundError, ValidationError } from "../../domain/errors";
import type { AbuseAction, AbuseContext, AbuseDecision, AbuseSignal, AbuseTarget, AbuseTargetKind, RateRule, Restriction } from "../../domain/model";
import type {
  IAbuseSignalProvider,
  IAuthorizationService,
  ICaptchaVerifier,
  IClock,
  IDomainEvents,
  IIdGenerator,
  ILogger,
  IMetrics,
  IRateLimiter,
  IRestrictionRepository,
  IUserRepository,
} from "../../domain/ports";
import { decideAbuse, DEFAULT_ABUSE_THRESHOLDS, rateKey, targetsOf, targetValue, type AbuseThresholds } from "../../domain/rules/abuse";

/** Lo único que necesitan quienes usan el freno (ISP): decidir o hacer cumplir. */
export interface IAbusePolicy {
  check(ctx: AbuseContext): Promise<AbuseDecision>;
  /** Tira AbuseRejectedError si hay que frenar el pedido. */
  enforce(ctx: AbuseContext): Promise<void>;
}

export interface AbuseGuardOptions {
  rules: RateRule[];
  /** Acciones que siempre piden captcha (si hay verificador). */
  captchaAlways: AbuseAction[];
  thresholds?: AbuseThresholds;
  /** Rechazos seguidos que convierten el freno en un bloqueo automático por un rato. */
  autoBlock: { rejectionsInWindow: number; windowSeconds: number; blockSeconds: number };
}

const SYSTEM = "sistema:abuso";
/** Sobre quién cae el bloqueo automático, según la acción (el identificador más estable). */
const AUTO_BLOCK_TARGET: Record<AbuseAction, AbuseTargetKind[]> = {
  // También la casilla: si alguien insiste en pedir altas para un mail ajeno, se protege a esa casilla.
  signup: ["email", "ip"],
  login: ["ip"],
  magic_link: ["email", "ip"],
  inbound_message: ["address"],
  api_request: ["user", "ip"],
  expensive: ["user"],
  room_message: ["user"],
};

/**
 * FRENO CONTRA EL ABUSO: junta restricciones vigentes, límites de frecuencia, señales
 * (mail descartable, cliente automatizado…) y captcha, y decide: permitir, pedir captcha
 * o rechazar. No sabe qué señales ni qué captcha hay (DIP): se inyectan.
 */
export class AbuseGuard implements IAbusePolicy {
  private readonly thresholds: AbuseThresholds;

  constructor(
    private readonly limiter: IRateLimiter,
    private readonly restrictions: IRestrictionRepository,
    private readonly providers: IAbuseSignalProvider[],
    private readonly opts: AbuseGuardOptions,
    private readonly events: IDomainEvents,
    private readonly ids: IIdGenerator,
    private readonly logger: ILogger,
    private readonly metrics?: IMetrics,
    private readonly captcha?: ICaptchaVerifier,
  ) {
    this.thresholds = opts.thresholds ?? DEFAULT_ABUSE_THRESHOLDS;
  }

  async check(ctx: AbuseContext): Promise<AbuseDecision> {
    const decision = await this.decide(ctx);
    this.metrics?.increment("sinhumo_abuse_decisions_total", { action: ctx.action, outcome: decision.outcome });
    if (decision.outcome === "deny") await this.maybeAutoBlock(ctx, decision);
    return decision;
  }

  async enforce(ctx: AbuseContext): Promise<void> {
    const d = await this.check(ctx);
    if (d.outcome === "deny") {
      const restricted = d.signals.some((s) => s.type === "restricted");
      throw new AbuseRejectedError(d.reason || "Demasiados pedidos. Probá más tarde.", restricted ? "restricted" : "too_many_attempts", d.retryAfterSeconds);
    }
    if (d.outcome === "challenge") throw new AbuseRejectedError(`${d.reason} Resolvé la verificación para seguir.`.trim(), "captcha_required");
  }

  private async decide(ctx: AbuseContext): Promise<AbuseDecision> {
    const signals: AbuseSignal[] = [];
    let retryAfter = 0;

    // 1) Restricciones vigentes: un bloqueo corta todo; una "observación" pide captcha.
    const active = await this.restrictions.findActive(targetsOf(ctx), ctx.at);
    const block = active.find((r) => r.level === "block");
    if (block) {
      const secs = block.until ? Math.ceil((block.until.getTime() - ctx.at.getTime()) / 1000) : undefined;
      return { outcome: "deny", reason: "El acceso está restringido. Si creés que es un error, escribí a soporte.", retryAfterSeconds: secs, signals: [{ type: "restricted", weight: 100, detail: block.reason }] };
    }
    if (active.length) signals.push({ type: "restricted", weight: this.thresholds.challenge, detail: "Hay una verificación pendiente." });

    // 2) Límites de frecuencia de esta acción.
    for (const rule of this.opts.rules.filter((r) => r.action === ctx.action)) {
      const key = rateKey(rule, ctx);
      if (!key) continue;
      const r = await this.limiter.consume(`rl:${key}`, rule.limit, rule.windowSeconds, ctx.at);
      if (r.allowed) continue;
      retryAfter = Math.max(retryAfter, r.retryAfterSeconds);
      signals.push({
        type: "rate_limit",
        weight: rule.onExceed === "deny" ? 100 : this.thresholds.challenge,
        detail: rule.onExceed === "deny" ? "Demasiados pedidos seguidos." : "Hay mucha actividad desde tu red.",
      });
    }

    // 3) Señales (cada proveedor mira lo suyo; si uno falla, no frena a nadie).
    for (const p of this.providers) {
      try {
        signals.push(...(await p.inspect(ctx)));
      } catch (e) {
        this.logger.warn("Falló una señal de abuso", { provider: p.id, error: String(e) });
      }
    }

    const d = decideAbuse(signals, this.thresholds);
    if (d.outcome === "deny") return { ...d, retryAfterSeconds: retryAfter || undefined };

    // 4) Captcha: por política de la acción o porque las señales lo piden.
    const wanted = d.outcome === "challenge" || (this.opts.captchaAlways.includes(ctx.action) && !ctx.captchaExempt);
    if (!wanted) return d;
    if (!this.captcha) {
      // Sin verificador configurado no se puede desafiar: lo sospechoso se rechaza, lo demás pasa.
      return d.outcome === "challenge" ? { outcome: "deny", reason: d.reason, signals: d.signals } : d;
    }
    if (ctx.captchaToken && (await this.captcha.verify(ctx.captchaToken, ctx.ip)).ok) return { outcome: "allow", signals: d.signals };
    return { outcome: "challenge", reason: d.outcome === "challenge" ? d.reason : "", signals: d.signals };
  }

  /** Quien insiste después de varios rechazos queda bloqueado un rato (y queda registrado). */
  private async maybeAutoBlock(ctx: AbuseContext, d: AbuseDecision): Promise<void> {
    if (d.signals.some((s) => s.type === "restricted")) return;
    const { rejectionsInWindow, windowSeconds, blockSeconds } = this.opts.autoBlock;
    for (const kind of AUTO_BLOCK_TARGET[ctx.action]) {
      const value = targetValue(kind, ctx);
      if (!value) continue;
      const r = await this.limiter.consume(`rechazos:${kind}:${value}`, rejectionsInWindow, windowSeconds, ctx.at);
      if (r.count !== rejectionsInWindow + 1) continue; // sólo al cruzar el umbral (una restricción, no una por pedido)
      const restriction: Restriction = {
        id: this.ids.next("rst"),
        target: { kind, value },
        level: "block",
        reason: `Bloqueo automático: ${rejectionsInWindow} pedidos rechazados en ${Math.round(windowSeconds / 60)} min (${ctx.action}).`,
        createdAt: ctx.at,
        until: new Date(ctx.at.getTime() + blockSeconds * 1000),
        createdBy: SYSTEM,
        automatic: true,
      };
      await this.restrictions.save(restriction);
      await this.events.emit("abuse.restricted", { userId: SYSTEM }, { target: `${kind}:${value}`, automatic: true, action: ctx.action }, { type: "restriction", id: restriction.id });
      this.logger.warn("Bloqueo automático por abuso", { target: `${kind}:${value}`, action: ctx.action });
    }
  }
}

/**
 * RESTRICCIONES MANUALES: soporte o administración bloquean o ponen en observación a una
 * persona, una red, un número o un mail, y las levantan. Todo queda auditado.
 */
export class RestrictionAdmin {
  constructor(
    private readonly repo: IRestrictionRepository,
    private readonly users: IUserRepository,
    private readonly authz: IAuthorizationService,
    private readonly events: IDomainEvents,
    private readonly ids: IIdGenerator,
    private readonly clock: IClock,
  ) {}

  async restrict(input: { actorId: string; target: AbuseTarget; level: "challenge" | "block"; reason: string; hours?: number }): Promise<Restriction> {
    const actor = await this.manager(input.actorId);
    if (!["user", "ip", "address", "email"].includes(input.target.kind) || !input.target.value?.trim()) throw new ValidationError("Indicá a quién se restringe (persona, red, número o mail).");
    if ((input.reason ?? "").trim().length < 5) throw new ValidationError("El motivo es obligatorio.");
    if (input.target.kind === "user" && input.target.value === actor.id) throw new ValidationError("No te podés restringir a vos.");
    const now = this.clock.now();
    const r: Restriction = {
      id: this.ids.next("rst"),
      target: { kind: input.target.kind, value: input.target.value.trim() },
      level: input.level,
      reason: input.reason.trim(),
      createdAt: now,
      until: input.hours ? new Date(now.getTime() + input.hours * 3_600_000) : undefined,
      createdBy: actor.id,
      automatic: false,
    };
    await this.repo.save(r);
    await this.events.emit("abuse.restricted", { userId: actor.id, organizationId: actor.organizationId }, { target: `${r.target.kind}:${r.target.value}`, level: r.level, automatic: false }, { type: "restriction", id: r.id });
    return r;
  }

  async lift(input: { actorId: string; id: string }): Promise<Restriction> {
    const actor = await this.manager(input.actorId);
    const r = await this.repo.findById(input.id);
    if (!r) throw new NotFoundError("No existe esa restricción.");
    const lifted = { ...r, liftedAt: this.clock.now(), liftedBy: actor.id };
    await this.repo.save(lifted);
    await this.events.emit("abuse.lifted", { userId: actor.id, organizationId: actor.organizationId }, { target: `${r.target.kind}:${r.target.value}` }, { type: "restriction", id: r.id });
    return lifted;
  }

  async list(actorId: string, limit = 100): Promise<Restriction[]> {
    await this.manager(actorId);
    return this.repo.findRecent(Math.min(limit, 500));
  }

  private async manager(id: string) {
    const u = await this.users.findById(id);
    if (!u || !(await this.authz.permissionsOf(u)).has("abuse:manage")) throw new AccessDeniedError("No gestionás restricciones.", "no_permission");
    return u;
  }
}
