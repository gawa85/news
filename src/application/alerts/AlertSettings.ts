import { NotFoundError } from "../../domain/errors";
import type { AlertRule } from "../../domain/model";
import type { IAlertRuleRepository } from "../../domain/ports";
import type { AccessControl } from "../access/AccessControl";

/** Lo que se muestra de una alerta (sin el estado interno del evaluador). */
export type AlertView = Pick<AlertRule, "id" | "topic" | "trigger" | "channel" | "outletId" | "active" | "createdAt" | "lastCheckedAt">;

/**
 * Mis alertas: ver y apagar. (Crear es CreateAlertUseCase: ahí están las reglas de plan y canal.)
 * REGLA: cada uno ve y apaga sólo las suyas; una alerta ajena responde "no existe".
 */
export class AlertSettings {
  constructor(
    private readonly alerts: IAlertRuleRepository,
    private readonly access: AccessControl,
  ) {}

  async list(actorId: string): Promise<AlertView[]> {
    const actor = await this.access.userOrThrow(actorId);
    return (await this.alerts.findByUser(actor.id))
      .filter((a) => a.active)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(view);
  }

  async deactivate(input: { actorId: string; alertId: string }): Promise<AlertView> {
    const actor = await this.access.userOrThrow(input.actorId);
    const rule = (await this.alerts.findByUser(actor.id)).find((a) => a.id === input.alertId);
    if (!rule) throw new NotFoundError("No existe esa alerta.");
    const off = { ...rule, active: false };
    await this.alerts.save(off);
    return view(off);
  }
}

const view = ({ id, topic, trigger, channel, outletId, active, createdAt, lastCheckedAt }: AlertRule): AlertView => ({ id, topic, trigger, channel, outletId, active, createdAt, lastCheckedAt });
