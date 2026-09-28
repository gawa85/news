import { createHmac } from "node:crypto";
import { AccessDeniedError, NotFoundError, ValidationError } from "../../domain/errors";
import type { PublicRoomMessage, Room, RoomEvent, RoomKind, RoomMessage, User } from "../../domain/model";
import type { IAuthorizationService, IClock, IParameterStore } from "../../domain/ports";
import { aliasFromDigest, eventStatus, isMuted } from "../../domain/rules/rooms";
import type { AccessControl } from "../access/AccessControl";

/**
 * QUIÉN PUEDE QUÉ en una sala, según su tipo (Strategy): el servicio de salas no sabe de
 * organizaciones ni de eventos; le pregunta a la política. Un tipo nuevo de sala = otra clase.
 */
export interface RoomPolicy {
  readonly kind: RoomKind;
  /** ¿Puede leer? (sin persona = sin cuenta). Si no, tira el error que corresponde. */
  canRead(actor: User | undefined, room: Room): Promise<void>;
  canWrite(actor: User, room: Room): Promise<void>;
  canModerate(actor: User, room: Room): Promise<boolean>;
  /** Segundos mínimos entre mensajes de una persona. */
  slowModeSeconds(room: Room): Promise<number>;
  /** Datos que la política agrega a un mensaje nuevo (p. ej. el seudónimo). */
  decorate(m: RoomMessage): RoomMessage;
  /** Lo que ven los demás de un mensaje. */
  view(m: RoomMessage): RoomMessage | PublicRoomMessage;
  presence(userIds: string[]): RoomEvent;
}

/** Salas de equipo: las reglas de siempre (miembros de la organización con permiso y plan). */
export class TeamRoomPolicy implements RoomPolicy {
  readonly kind = "team" as const;

  constructor(
    private readonly authz: IAuthorizationService,
    private readonly access: AccessControl,
  ) {}

  /** Miembro de una organización, con `rooms:use` y plan con `team_rooms`. */
  async requireMember(actor: User | undefined): Promise<User> {
    if (!actor || actor.status !== "active") throw new NotFoundError("Usuario inexistente.");
    if (!actor.organizationId) throw new AccessDeniedError("Las salas son para equipos de una organización.", "no_permission");
    if (!(await this.authz.permissionsOf(actor)).has("rooms:use")) throw new AccessDeniedError("Tu rol no permite usar las salas.", "no_permission");
    const { plan } = await this.access.planOf(actor);
    if (!plan.features.includes("team_rooms")) throw new AccessDeniedError(`Las salas no están en el plan ${plan.name}.`, "feature_not_in_plan");
    return actor;
  }

  async canRead(actor: User | undefined, room: Room): Promise<void> {
    const a = await this.requireMember(actor);
    if (room.organizationId !== a.organizationId) throw new AccessDeniedError("Esa sala es de otra organización.", "no_permission");
  }

  canWrite(actor: User, room: Room): Promise<void> {
    return this.canRead(actor, room);
  }

  async canModerate(actor: User): Promise<boolean> {
    return (await this.authz.permissionsOf(actor)).has("replies:moderate");
  }

  async slowModeSeconds(room: Room): Promise<number> {
    return room.slowModeSeconds;
  }

  decorate(m: RoomMessage): RoomMessage {
    return m;
  }

  view(m: RoomMessage): RoomMessage {
    return m;
  }

  presence(userIds: string[]): RoomEvent {
    return { type: "presence", userIds };
  }
}

/**
 * Eventos públicos en vivo: cualquiera lee (también sin cuenta, para insertarla en el sitio
 * de un medio); escribir pide una cuenta con antigüedad (frena las cuentas creadas para
 * copar la sala), que el evento esté en vivo y no estar silenciado. Nadie ve quién es
 * quién: cada persona tiene un seudónimo por sala, y la presencia es una cantidad.
 */
export class EventRoomPolicy implements RoomPolicy {
  readonly kind = "event" as const;

  constructor(
    private readonly authz: IAuthorizationService,
    private readonly params: IParameterStore,
    private readonly clock: IClock,
    /** Clave del seudónimo: sin ella no se puede averiguar quién es quién. */
    private readonly aliasSecret: string,
  ) {}

  async canRead(): Promise<void> {
    /* público */
  }

  async canWrite(actor: User, room: Room): Promise<void> {
    if (actor.status !== "active") throw new AccessDeniedError("Tu cuenta no está activa.", "user_inactive");
    const now = this.clock.now();
    const status = eventStatus(room.event!, now);
    if (status === "scheduled") throw new ValidationError("El evento todavía no empezó: se puede leer, pero no escribir.");
    if (status === "closed") throw new ValidationError("El evento terminó.");
    // El equipo del evento no tiene tope de antigüedad ni se silencia.
    if (await this.canModerate(actor)) return;
    const until = isMuted(room.event!, actor.id, now);
    if (until) throw new AccessDeniedError(`Te silenciaron en este evento hasta las ${until.toISOString().slice(11, 16)} UTC.`, "no_permission");
    const minutes = await this.params.number("events.min_account_minutes");
    if (now.getTime() - actor.createdAt.getTime() < minutes * 60_000) {
      throw new AccessDeniedError(`Las cuentas nuevas pueden escribir en los eventos después de ${minutes} minutos. Mientras tanto, podés leer.`, "no_permission");
    }
  }

  async canModerate(actor: User): Promise<boolean> {
    return (await this.authz.permissionsOf(actor)).has("events:host");
  }

  async slowModeSeconds(room: Room): Promise<number> {
    return Math.max(room.slowModeSeconds, await this.params.number("events.slow_mode_seconds"));
  }

  decorate(m: RoomMessage): RoomMessage {
    const digest = createHmac("sha256", this.aliasSecret).update(`${m.roomId}|${m.authorId}`).digest("hex");
    return { ...m, alias: m.flags.includes("verificacion") ? "Equipo del evento" : aliasFromDigest(digest) };
  }

  view(m: RoomMessage): PublicRoomMessage {
    const { authorId: _, ...rest } = m;
    return rest;
  }

  presence(userIds: string[]): RoomEvent {
    return { type: "presence", count: new Set(userIds).size };
  }
}
