import { createHash, randomUUID } from "node:crypto";
import type { ComplianceDecision, DeliveryOutcome, DestinationHealth, SendContext } from "../../domain/model";
import type {
  IClock,
  IConversationWindowRepository,
  IDeliveryLog,
  IDestinationHealthRepository,
  IOptOutRepository,
  IPlatformPolicyRegistry,
} from "../../domain/ports";

export interface GuardOptions {
  /** Fallas seguidas (no 429/403) antes de enfriar el destino. */
  failureThreshold: number;
  baseCooldownMinutes: number;
  maxCooldownMinutes: number;
}

const DEFAULTS: GuardOptions = { failureThreshold: 3, baseCooldownMinutes: 5, maxCooldownMinutes: 24 * 60 };

/**
 * CUMPLIMIENTO Y REPUTACIÓN DE ENVÍO.
 *
 * Antes de cada envío o publicación:
 *  - destino pausado o enfriándose → no se envía;
 *  - persona que pidió la baja → no se le mandan avisos (sí respuestas a lo que pregunte);
 *  - ventana de conversación (WhatsApp 24 h) → fuera de ella, sólo plantillas aprobadas;
 *  - límites de frecuencia por minuto/hora/día y por destinatario.
 *
 * Después de cada intento registra el resultado y reacciona solo:
 *  - 429 (el proveedor pide bajar el ritmo) → enfría el destino con espera creciente;
 *  - 403 / rechazo por spam / cuenta advertida → PAUSA el destino hasta revisión humana;
 *  - fallas repetidas → enfría.
 *
 * No existe un propósito "envío no solicitado": el sistema sólo responde a quien preguntó,
 * avisa lo que la persona configuró o manda un código que la persona pidió.
 */
export class ComplianceGuard {
  private readonly opts: GuardOptions;

  constructor(
    private readonly policies: IPlatformPolicyRegistry,
    private readonly log: IDeliveryLog,
    private readonly health: IDestinationHealthRepository,
    private readonly optOuts: IOptOutRepository,
    private readonly windows: IConversationWindowRepository,
    private readonly clock: IClock,
    opts: Partial<GuardOptions> = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  async check(ctx: SendContext): Promise<ComplianceDecision> {
    const now = this.clock.now();
    const policy = this.policies.policyFor(ctx.destination);
    const channel = ctx.destination.split(":")[0]!;

    const h = await this.health.get(ctx.destination);
    if (h?.state === "paused") {
      return { allowed: false, code: "destination_paused", message: `Envíos a ${ctx.destination} pausados: ${h.reason ?? "revisión pendiente"}.` };
    }
    if (h?.state === "cooling_down" && h.until && h.until > now) {
      return { allowed: false, code: "rate_limited", message: `Envíos a ${ctx.destination} en pausa temporal.`, retryAt: h.until };
    }

    // La baja corta los AVISOS. Si la persona escribe, se le responde; y el código que pide, se le manda.
    if (ctx.purpose === "notification" && (await this.optOuts.isOptedOut(channel, ctx.recipient))) {
      return { allowed: false, code: "opted_out", message: "La persona pidió no recibir más mensajes." };
    }

    if (policy.conversationWindowHours && !ctx.isTemplate) {
      const last = await this.windows.lastInbound(channel, ctx.recipient);
      const open = last && now.getTime() - last.getTime() <= policy.conversationWindowHours * 3_600_000;
      if (!open) {
        return {
          allowed: false,
          code: "outside_window",
          message: `Pasaron más de ${policy.conversationWindowHours} h desde el último mensaje de la persona: sólo se puede usar una plantilla aprobada.`,
        };
      }
    }

    const limits: [number | undefined, number][] = [
      [policy.maxPerMinute, 60_000],
      [policy.maxPerHour, 3_600_000],
      [policy.maxPerDay, 86_400_000],
    ];
    for (const [max, windowMs] of limits) {
      if (max === undefined) continue;
      const sent = await this.log.countSent(ctx.destination, new Date(now.getTime() - windowMs));
      if (sent >= max) {
        return { allowed: false, code: "rate_limited", message: `Límite de ${max} envíos cada ${windowMs / 60_000} min en ${ctx.destination}.`, retryAt: new Date(now.getTime() + windowMs / Math.max(1, max)) };
      }
    }

    if (policy.minSecondsPerRecipient) {
      const last = await this.log.lastSent(ctx.destination, this.hash(ctx));
      if (last && now.getTime() - last.getTime() < policy.minSecondsPerRecipient * 1000) {
        return { allowed: false, code: "rate_limited", message: "Se le escribió hace muy poco a este destinatario.", retryAt: new Date(last.getTime() + policy.minSecondsPerRecipient * 1000) };
      }
    }

    return { allowed: true, mustDiscloseBot: policy.requiresBotDisclosure, mustIncludeUnsubscribe: policy.requiresUnsubscribe && ctx.purpose === "notification" };
  }

  /** Registra el resultado de un intento y ajusta la salud del destino. */
  async record(ctx: SendContext, outcome: DeliveryOutcome, detail?: string): Promise<void> {
    const now = this.clock.now();
    await this.log.record({ id: randomUUID(), destination: ctx.destination, recipientHash: this.hash(ctx), at: now, outcome, detail });
    if (outcome === "blocked_by_policy") return;

    const prev: DestinationHealth = (await this.health.get(ctx.destination)) ?? { destination: ctx.destination, state: "healthy", consecutiveFailures: 0, updatedAt: now };
    let next: DestinationHealth;
    if (outcome === "sent") {
      next = { ...prev, state: prev.state === "paused" ? "paused" : "healthy", consecutiveFailures: 0, until: undefined, reason: prev.state === "paused" ? prev.reason : undefined, updatedAt: now };
    } else if (outcome === "provider_rejected") {
      next = { ...prev, state: "paused", reason: `El proveedor rechazó el envío (${detail ?? "sin detalle"}). Revisar antes de reanudar.`, consecutiveFailures: prev.consecutiveFailures + 1, updatedAt: now };
    } else {
      const failures = prev.consecutiveFailures + 1;
      const throttled = outcome === "provider_throttled";
      const cool = throttled || failures >= this.opts.failureThreshold;
      const minutes = Math.min(this.opts.maxCooldownMinutes, this.opts.baseCooldownMinutes * 2 ** Math.max(0, failures - 1));
      next = cool
        ? { ...prev, state: "cooling_down", reason: throttled ? "El proveedor pidió bajar el ritmo (429)." : "Fallas repetidas.", until: new Date(now.getTime() + minutes * 60_000), consecutiveFailures: failures, updatedAt: now }
        : { ...prev, consecutiveFailures: failures, updatedAt: now };
    }
    await this.health.save(next);
  }

  /** Reanudar un destino pausado (acción humana, tras revisar la causa). */
  async resume(destination: string): Promise<void> {
    await this.health.save({ destination, state: "healthy", consecutiveFailures: 0, updatedAt: this.clock.now() });
  }

  private hash(ctx: SendContext): string {
    return createHash("sha256").update(`${ctx.destination}|${ctx.recipient.trim().toLowerCase()}`).digest("hex").slice(0, 32);
  }
}

/** Traduce la respuesta de un proveedor a un resultado de entrega. */
export function outcomeOf(result: { ok: boolean; httpStatus?: number; error?: string }): DeliveryOutcome {
  if (result.ok) return "sent";
  if (result.httpStatus === 429) return "provider_throttled";
  if (result.httpStatus === 401 || result.httpStatus === 403 || /spam|blocked|banned|bloquead|suspend/i.test(result.error ?? "")) return "provider_rejected";
  return "failed";
}
