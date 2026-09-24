import { AccessDeniedError, NotFoundError, ValidationError } from "../../domain/errors";
import type { Room, RoomEvent, RoomMessage, User } from "../../domain/model";
import type {
  IAuthorizationService,
  IClock,
  IIdGenerator,
  IRealtimeTransport,
  IReviewModerator,
  IRoomRepository,
  IUserRepository,
} from "../../domain/ports";
import type { AccessControl } from "../access/AccessControl";

/**
 * SALAS EN TIEMPO REAL para organizaciones: discutir un dato, una verificación
 * o una campaña con el equipo, sin salir de la plataforma.
 *
 * REGLAS:
 *  - Sólo miembros de la organización con `rooms:use` y plan con `team_rooms`.
 *  - Modo lento opcional (segundos mínimos entre mensajes de una persona).
 *  - Moderación: lenguaje ofensivo no se publica.
 *  - Un mensaje con cifras y sin link queda marcado "sin fuente".
 *  - Borrar: el autor o un moderador; queda la marca de borrado.
 */
export class RoomService {
  constructor(
    private readonly rooms: IRoomRepository,
    private readonly realtime: IRealtimeTransport,
    private readonly users: IUserRepository,
    private readonly authz: IAuthorizationService,
    private readonly access: AccessControl,
    private readonly moderator: IReviewModerator,
    private readonly ids: IIdGenerator,
    private readonly clock: IClock,
  ) {}

  async create(input: { actorId: string; name: string; topic?: string; linkedTo?: Room["linkedTo"]; slowModeSeconds?: number }): Promise<Room> {
    const actor = await this.member(input.actorId);
    if (input.name.trim().length < 3) throw new ValidationError("Poné un nombre a la sala.");
    const room: Room = {
      id: this.ids.next("room"), organizationId: actor.organizationId!, name: input.name.trim(), topic: input.topic,
      linkedTo: input.linkedTo, createdBy: actor.id, createdAt: this.clock.now(), archived: false, slowModeSeconds: input.slowModeSeconds ?? 0,
    };
    await this.rooms.save(room);
    return room;
  }

  async list(actorId: string): Promise<Room[]> {
    const actor = await this.member(actorId);
    return (await this.rooms.findByOrganization(actor.organizationId!)).filter((r) => !r.archived);
  }

  async post(input: { actorId: string; roomId: string; text: string; replyTo?: string }): Promise<RoomMessage> {
    const { actor, room } = await this.enter(input.actorId, input.roomId);
    const text = input.text.trim();
    if (!text || text.length > 4000) throw new ValidationError("El mensaje tiene que tener entre 1 y 4000 caracteres.");
    if (room.slowModeSeconds > 0) {
      const last = await this.rooms.lastMessageBy(room.id, actor.id);
      const wait = last ? room.slowModeSeconds * 1000 - (this.clock.now().getTime() - last.at.getTime()) : 0;
      if (wait > 0) throw new ValidationError(`Modo lento: esperá ${Math.ceil(wait / 1000)} s.`);
    }
    if ((await this.moderator.moderate(text)).verdict === "reject") throw new ValidationError("El mensaje no pasa la moderación.");
    const links = text.match(/https?:\/\/[^\s)]+/g) ?? [];
    const msg: RoomMessage = {
      id: this.ids.next("msg"), roomId: room.id, authorId: actor.id, text, links,
      flags: /\d/.test(text.replace(/https?:\/\/\S+/g, "")) && /\d+(?:[.,]\d+)?\s*(%|millones|mil|pesos|dólares|usd)/i.test(text) && links.length === 0 ? ["sin_fuente"] : [],
      replyTo: input.replyTo, at: this.clock.now(), deleted: false,
    };
    await this.rooms.addMessage(msg);
    this.realtime.publish(room.id, { type: "message", message: msg });
    return msg;
  }

  async remove(input: { actorId: string; messageId: string }): Promise<void> {
    const msg = await this.rooms.findMessage(input.messageId);
    if (!msg) throw new NotFoundError("No existe ese mensaje.");
    const { actor } = await this.enter(input.actorId, msg.roomId);
    const canModerate = (await this.authz.permissionsOf(actor)).has("replies:moderate");
    if (msg.authorId !== actor.id && !canModerate) throw new AccessDeniedError("Sólo el autor o un moderador puede borrarlo.", "no_permission");
    await this.rooms.saveMessage({ ...msg, deleted: true, text: "" });
    this.realtime.publish(msg.roomId, { type: "deleted", messageId: msg.id });
  }

  /** Entrar a la sala: historial + suscripción a lo nuevo + presencia. */
  async join(input: { actorId: string; roomId: string; historyLimit?: number }, listener: (e: RoomEvent) => void): Promise<{ history: RoomMessage[]; leave: () => void }> {
    const { actor, room } = await this.enter(input.actorId, input.roomId);
    const history = await this.rooms.history(room.id, input.historyLimit ?? 50);
    const off = this.realtime.subscribe(room.id, actor.id, listener);
    this.realtime.publish(room.id, { type: "presence", userIds: this.realtime.present(room.id) });
    return {
      history,
      leave: () => {
        off();
        this.realtime.publish(room.id, { type: "presence", userIds: this.realtime.present(room.id) });
      },
    };
  }

  private async enter(actorId: string, roomId: string): Promise<{ actor: User; room: Room }> {
    const actor = await this.member(actorId);
    const room = await this.rooms.findById(roomId);
    if (!room || room.archived) throw new NotFoundError("No existe esa sala.");
    if (room.organizationId !== actor.organizationId) throw new AccessDeniedError("Esa sala es de otra organización.", "no_permission");
    return { actor, room };
  }

  private async member(actorId: string): Promise<User> {
    const actor = await this.users.findById(actorId);
    if (!actor || actor.status !== "active") throw new NotFoundError("Usuario inexistente.");
    if (!actor.organizationId) throw new AccessDeniedError("Las salas son para equipos de una organización.", "no_permission");
    if (!(await this.authz.permissionsOf(actor)).has("rooms:use")) throw new AccessDeniedError("Tu rol no permite usar las salas.", "no_permission");
    const { plan } = await this.access.planOf(actor);
    if (!plan.features.includes("team_rooms")) throw new AccessDeniedError(`Las salas no están en el plan ${plan.name}.`, "feature_not_in_plan");
    return actor;
  }
}
