import { randomUUID } from "node:crypto";
import { AccessDeniedError, NotFoundError, ValidationError } from "../../domain/errors";
import type { PublicRoomMessage, Room, RoomEvent, RoomMessage, User } from "../../domain/model";
import type { IClock, IIdGenerator, IRealtimeTransport, IReviewModerator, IRoomRepository, IUserRepository } from "../../domain/ports";
import type { IAbusePolicy } from "../abuse/AbuseGuard";
import type { RoomPolicy, TeamRoomPolicy } from "./RoomPolicies";

/**
 * SALAS EN TIEMPO REAL: equipos de una organización y eventos públicos en vivo.
 * Qué puede hacer cada quien depende del TIPO de sala y lo decide su política (Strategy):
 * este servicio sólo orquesta (guardar, moderar, publicar en tiempo real).
 *
 * REGLAS COMUNES:
 *  - Modo lento para todos (lo que diga la política); sólo los chequeos del equipo no esperan.
 *  - Moderación: lenguaje ofensivo no se publica. Tope de mensajes por persona (abuso).
 *  - Un mensaje con cifras y sin link queda marcado "sin fuente".
 *  - Borrar: el autor o quien modera esa sala; queda la marca de borrado.
 */
export class RoomService {
  private readonly policies: Map<string, RoomPolicy>;

  constructor(
    private readonly rooms: IRoomRepository,
    private readonly realtime: IRealtimeTransport,
    private readonly users: IUserRepository,
    private readonly team: TeamRoomPolicy,
    others: RoomPolicy[],
    private readonly moderator: IReviewModerator,
    private readonly ids: IIdGenerator,
    private readonly clock: IClock,
    private readonly abuse?: IAbusePolicy,
  ) {
    this.policies = new Map<string, RoomPolicy>([[team.kind, team], ...others.map((p) => [p.kind, p] as const)]);
  }

  /** Sala de equipo nueva (los eventos se crean con EventRoomService). */
  async create(input: { actorId: string; name: string; topic?: string; linkedTo?: Room["linkedTo"]; slowModeSeconds?: number }): Promise<Room> {
    const actor = await this.team.requireMember(await this.users.findById(input.actorId));
    if (input.name.trim().length < 3) throw new ValidationError("Poné un nombre a la sala.");
    const room: Room = {
      id: this.ids.next("room"), kind: "team", organizationId: actor.organizationId!, name: input.name.trim(), topic: input.topic,
      linkedTo: input.linkedTo, createdBy: actor.id, createdAt: this.clock.now(), archived: false, slowModeSeconds: input.slowModeSeconds ?? 0,
    };
    await this.rooms.save(room);
    return room;
  }

  async list(actorId: string): Promise<Room[]> {
    const actor = await this.team.requireMember(await this.users.findById(actorId));
    return (await this.rooms.findByOrganization(actor.organizationId!)).filter((r) => !r.archived);
  }

  /** `kind: "verificacion"`: chequeo del equipo de la sala (sólo quien modera; no espera el modo lento). */
  async post(input: { actorId: string; roomId: string; text: string; replyTo?: string; kind?: "verificacion" }): Promise<RoomMessage> {
    const room = await this.room(input.roomId);
    const policy = this.policyOf(room);
    const actor = await this.users.findById(input.actorId);
    if (!actor) throw new NotFoundError("Usuario inexistente.");
    await policy.canWrite(actor, room);
    const moderates = await policy.canModerate(actor, room);
    if (input.kind === "verificacion" && !moderates) throw new AccessDeniedError("Sólo el equipo de la sala publica chequeos.", "no_permission");

    const text = input.text.trim();
    if (!text || text.length > 4000) throw new ValidationError("El mensaje tiene que tener entre 1 y 4000 caracteres.");
    // Los chequeos del equipo no esperan (son lo más importante del evento); el resto, sí.
    if (input.kind !== "verificacion") {
      await this.abuse?.enforce({ action: "room_message", at: this.clock.now(), userId: actor.id });
      const slow = await policy.slowModeSeconds(room);
      if (slow > 0) {
        const last = await this.rooms.lastMessageBy(room.id, actor.id);
        const wait = last ? slow * 1000 - (this.clock.now().getTime() - last.at.getTime()) : 0;
        if (wait > 0) throw new ValidationError(`Modo lento: esperá ${Math.ceil(wait / 1000)} s.`);
      }
    }
    if ((await this.moderator.moderate(text)).verdict === "reject") throw new ValidationError("El mensaje no pasa la moderación.");
    const links = text.match(/https?:\/\/[^\s)]+/g) ?? [];
    const noSource = /\d/.test(text.replace(/https?:\/\/\S+/g, "")) && /\d+(?:[.,]\d+)?\s*(%|millones|mil|pesos|dólares|usd)/i.test(text) && links.length === 0;
    const msg = policy.decorate({
      id: this.ids.next("msg"), roomId: room.id, authorId: actor.id, text, links,
      flags: input.kind === "verificacion" ? ["verificacion"] : noSource ? ["sin_fuente"] : [],
      replyTo: input.replyTo, at: this.clock.now(), deleted: false,
    });
    await this.rooms.addMessage(msg);
    this.realtime.publish(room.id, { type: "message", message: policy.view(msg) });
    return msg;
  }

  async remove(input: { actorId: string; messageId: string }): Promise<void> {
    const msg = await this.rooms.findMessage(input.messageId);
    if (!msg) throw new NotFoundError("No existe ese mensaje.");
    const room = await this.room(msg.roomId);
    const policy = this.policyOf(room);
    const actor = await this.users.findById(input.actorId);
    if (!actor) throw new NotFoundError("Usuario inexistente.");
    await policy.canRead(actor, room);
    if (msg.authorId !== actor.id && !(await policy.canModerate(actor, room))) throw new AccessDeniedError("Sólo el autor o un moderador puede borrarlo.", "no_permission");
    await this.rooms.saveMessage({ ...msg, deleted: true, text: "" });
    this.realtime.publish(msg.roomId, { type: "deleted", messageId: msg.id });
  }

  /**
   * Entrar a la sala: historial + suscripción a lo nuevo + presencia.
   * Sin `actorId`: sólo lectura, y sólo si la política lo permite (eventos públicos).
   */
  async join(
    input: { actorId?: string; roomId: string; historyLimit?: number },
    listener: (e: RoomEvent) => void,
  ): Promise<{ room: Room; history: (RoomMessage | PublicRoomMessage)[]; leave: () => void }> {
    const room = await this.room(input.roomId);
    const policy = this.policyOf(room);
    const actor: User | undefined = input.actorId ? await this.users.findById(input.actorId) : undefined;
    if (input.actorId && !actor) throw new NotFoundError("Usuario inexistente.");
    await policy.canRead(actor, room);
    const history = (await this.rooms.history(room.id, input.historyLimit ?? 50)).map((m) => policy.view(m));
    const off = this.realtime.subscribe(room.id, actor?.id ?? `anon:${randomUUID()}`, listener);
    this.realtime.publish(room.id, policy.presence(this.realtime.present(room.id)));
    return {
      room,
      history,
      leave: () => {
        off();
        this.realtime.publish(room.id, policy.presence(this.realtime.present(room.id)));
      },
    };
  }

  /** Lo que ven los demás de un mensaje de esa sala. */
  viewOf(room: Room, m: RoomMessage): RoomMessage | PublicRoomMessage {
    return this.policyOf(room).view(m);
  }

  private async room(id: string): Promise<Room> {
    const room = await this.rooms.findById(id);
    if (!room || room.archived) throw new NotFoundError("No existe esa sala.");
    return room;
  }

  private policyOf(room: Room): RoomPolicy {
    const p = this.policies.get(room.kind ?? "team");
    if (!p) throw new NotFoundError("Tipo de sala desconocido.");
    return p;
  }
}
