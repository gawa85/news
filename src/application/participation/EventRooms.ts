import { AccessDeniedError, ConflictError, NotFoundError, ValidationError } from "../../domain/errors";
import type { EventInfo, PublicRoomMessage, ResponseContent, Room, RoomMessage, User } from "../../domain/model";
import type {
  IAuthorizationService,
  IClock,
  IDomainEvents,
  IEventSubscriptionRepository,
  IFeatureFlags,
  IIdGenerator,
  IJobQueue,
  IRealtimeTransport,
  IRoomRepository,
  IUserRepository,
} from "../../domain/ports";
import { eventCodeFrom, eventStatus, type EventStatus } from "../../domain/rules/rooms";
import type { RoomService } from "./Rooms";

/** Cómo se le avisa a una persona (lo resuelve NotificationService: silencio, canales, plantillas). */
export type EventNotify = (user: User, content: ResponseContent, template: { name: string; params: string[] }) => Promise<unknown>;

export interface PublicEvent {
  id: string;
  code: string;
  title: string;
  description?: string;
  host: string;
  startsAt: Date;
  endsAt: Date;
  status: EventStatus;
  watching: number;
  pinned: PublicRoomMessage[];
}

const MAX_HOURS = 24;
export const EVENT_NOTIFY_JOB = "event_factcheck_notify";

/**
 * EVENTOS EN VIVO (debates, elecciones, cadenas nacionales): salas públicas donde la gente
 * comenta y el equipo del evento publica chequeos en el momento. Quien no quiere seguir la
 * sala se suscribe por chat ("/evento <código>") y recibe sólo los chequeos.
 *
 * REGLAS:
 *  - Crear: permiso `events:host`. Cerrar, silenciar y publicar chequeos: quien lo organizó,
 *    o el equipo de la plataforma (`events:moderate_any`): un medio aliado no modera el de otro.
 *  - Duración máxima: 24 h. Se silencia a partir de un mensaje (el equipo ve seudónimos).
 *  - Los avisos a suscriptores salen por la cola (un evento puede tener miles).
 */
export class EventRoomService {
  constructor(
    private readonly rooms: IRoomRepository,
    private readonly subscriptions: IEventSubscriptionRepository,
    private readonly roomService: RoomService,
    private readonly realtime: IRealtimeTransport,
    private readonly users: IUserRepository,
    private readonly authz: IAuthorizationService,
    private readonly events: IDomainEvents,
    private readonly queue: IJobQueue,
    private readonly notify: EventNotify,
    private readonly ids: IIdGenerator,
    private readonly clock: IClock,
    /** Apagado de emergencia (`event_rooms`): no se crean eventos ni suscripciones. */
    private readonly flags?: IFeatureFlags,
  ) {}

  private async enabled(): Promise<void> {
    if (this.flags && !(await this.flags.isEnabled("event_rooms", {}))) throw new ValidationError("Los eventos en vivo están pausados.");
  }

  async create(input: { actorId: string; title: string; description?: string; startsAt: Date; endsAt: Date; host?: string; slowModeSeconds?: number }): Promise<Room> {
    await this.enabled();
    const actor = await this.host(input.actorId);
    const title = input.title.trim();
    if (title.length < 5) throw new ValidationError("Poné un título al evento.");
    if (!(input.endsAt > input.startsAt)) throw new ValidationError("El evento tiene que terminar después de empezar.");
    if (input.endsAt.getTime() - input.startsAt.getTime() > MAX_HOURS * 3_600_000) throw new ValidationError(`Un evento dura como mucho ${MAX_HOURS} horas.`);
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = eventCodeFrom(Math.floor(Math.random() * 887_503_681));
      if (await this.rooms.findByEventCode(code)) continue;
      const event: EventInfo = { code, title, description: input.description?.trim(), startsAt: input.startsAt, endsAt: input.endsAt, host: input.host?.trim() || "Sin Humo", muted: [], pinned: [] };
      const room: Room = { id: this.ids.next("room"), kind: "event", event, name: title, createdBy: actor.id, createdAt: this.clock.now(), archived: false, slowModeSeconds: input.slowModeSeconds ?? 0 };
      await this.rooms.save(room);
      await this.events.emit("event.created", { userId: actor.id, organizationId: actor.organizationId }, { code, title }, { type: "room", id: room.id });
      return room;
    }
    throw new ConflictError("No se pudo generar un código para el evento. Probá de nuevo.");
  }

  /** Eventos para la portada: en vivo primero, después los próximos, y los que terminaron hace poco. */
  async list(limit = 20): Promise<PublicEvent[]> {
    const now = this.clock.now();
    const order: Record<EventStatus, number> = { live: 0, scheduled: 1, closed: 2 };
    const out: PublicEvent[] = [];
    for (const r of await this.rooms.findEvents(100)) {
      if (r.archived || !r.event) continue;
      if (eventStatus(r.event, now) === "closed" && now.getTime() - r.event.endsAt.getTime() > 7 * 86_400_000) continue;
      out.push(await this.toPublic(r));
    }
    return out.sort((a, b) => order[a.status] - order[b.status] || a.startsAt.getTime() - b.startsAt.getTime()).slice(0, limit);
  }

  async get(codeOrId: string): Promise<PublicEvent> {
    return this.toPublic(await this.room(codeOrId));
  }

  /** Los eventos que puedo moderar (los míos; todos si soy del equipo de la plataforma), con los recién cerrados. */
  async hosted(actorId: string): Promise<PublicEvent[]> {
    const actor = await this.host(actorId);
    const all = (await this.authz.permissionsOf(actor)).has("events:moderate_any");
    const now = this.clock.now();
    const out: PublicEvent[] = [];
    for (const r of await this.rooms.findEvents(200)) {
      if (r.archived || !r.event || (!all && r.createdBy !== actor.id)) continue;
      if (eventStatus(r.event, now) === "closed" && now.getTime() - r.event.endsAt.getTime() > 7 * 86_400_000) continue;
      out.push(await this.toPublic(r));
    }
    return out.sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
  }

  async close(input: { actorId: string; roomId: string }): Promise<Room> {
    const room = await this.room(input.roomId);
    await this.moderator(input.actorId, room);
    const closed = { ...room, event: { ...room.event!, closedAt: this.clock.now() } };
    await this.rooms.save(closed);
    this.realtime.publish(room.id, { type: "closed" });
    return closed;
  }

  /** Silenciar a quien escribió un mensaje (y, si se pide, borrarlo). */
  async mute(input: { actorId: string; messageId: string; minutes: number; removeMessage?: boolean }): Promise<{ until: Date }> {
    const msg = await this.rooms.findMessage(input.messageId);
    if (!msg) throw new NotFoundError("No existe ese mensaje.");
    const room = await this.room(msg.roomId);
    await this.moderator(input.actorId, room);
    const minutes = Math.min(Math.max(1, Math.round(input.minutes)), MAX_HOURS * 60);
    const until = new Date(this.clock.now().getTime() + minutes * 60_000);
    const muted = [...room.event!.muted.filter((m) => m.userId !== msg.authorId), { userId: msg.authorId, until }];
    await this.rooms.save({ ...room, event: { ...room.event!, muted } });
    if (input.removeMessage) await this.roomService.remove({ actorId: input.actorId, messageId: msg.id });
    return { until };
  }

  /** Chequeo del equipo: se publica en la sala, se fija arriba y se avisa a los suscriptores. */
  async factCheck(input: { actorId: string; roomId: string; text: string }): Promise<RoomMessage> {
    const room = await this.room(input.roomId);
    const msg = await this.roomService.post({ actorId: input.actorId, roomId: room.id, text: input.text, kind: "verificacion" });
    const fresh = await this.room(room.id);
    await this.rooms.save({ ...fresh, event: { ...fresh.event!, pinned: [...fresh.event!.pinned, msg.id] } });
    await this.queue.enqueue(EVENT_NOTIFY_JOB, { roomId: room.id, messageId: msg.id }, { dedupeKey: `${EVENT_NOTIFY_JOB}:${msg.id}`, maxAttempts: 3 });
    return msg;
  }

  /** Lo corre la cola: avisa a cada suscriptor (respeta su silencio, sus canales y la ventana de WhatsApp). */
  async notifySubscribers(roomId: string, messageId: string): Promise<number> {
    const room = await this.room(roomId);
    const msg = await this.rooms.findMessage(messageId);
    if (!msg || msg.deleted) return 0;
    let sent = 0;
    for (const userId of await this.subscriptions.findSubscribers(room.id)) {
      const u = await this.users.findById(userId);
      if (!u || u.status !== "active") continue;
      const content: ResponseContent = {
        kind: "info",
        title: `Chequeo en vivo · ${room.event!.title}`,
        summary: msg.text,
        sections: [],
        links: [],
        footer: `Para dejar de recibirlos: /evento no ${room.event!.code}`,
      };
      await this.notify(u, content, { name: "chequeo_en_vivo", params: [room.event!.title, msg.text.slice(0, 200)] });
      sent++;
    }
    return sent;
  }

  async subscribe(input: { userId: string; code: string }): Promise<Room> {
    await this.enabled();
    const room = await this.room(input.code);
    if (eventStatus(room.event!, this.clock.now()) === "closed") throw new ValidationError("Ese evento ya terminó.");
    await this.subscriptions.subscribe(room.id, input.userId, this.clock.now());
    return room;
  }

  async unsubscribe(input: { userId: string; code: string }): Promise<void> {
    await this.subscriptions.unsubscribe((await this.room(input.code)).id, input.userId);
  }

  private async toPublic(r: Room): Promise<PublicEvent> {
    const e = r.event!;
    const pinned: PublicRoomMessage[] = [];
    for (const id of e.pinned.slice(-5)) {
      const m = await this.rooms.findMessage(id);
      if (m && !m.deleted) pinned.push(this.roomService.viewOf(r, m) as PublicRoomMessage);
    }
    return {
      id: r.id, code: e.code, title: e.title, description: e.description, host: e.host, startsAt: e.startsAt, endsAt: e.endsAt,
      status: eventStatus(e, this.clock.now()), watching: new Set(this.realtime.present(r.id)).size, pinned,
    };
  }

  private async room(codeOrId: string): Promise<Room> {
    const r = (await this.rooms.findByEventCode(codeOrId.trim())) ?? (await this.rooms.findById(codeOrId.trim()));
    if (!r || r.kind !== "event" || !r.event || r.archived) throw new NotFoundError("No existe ese evento.");
    return r;
  }

  private async host(actorId: string): Promise<User> {
    const u = await this.users.findById(actorId);
    if (!u || u.status !== "active" || !(await this.authz.permissionsOf(u)).has("events:host")) throw new AccessDeniedError("No organizás eventos.", "no_permission");
    return u;
  }
  private async moderator(actorId: string, room: Room): Promise<User> {
    const actor = await this.host(actorId);
    if (room.createdBy !== actor.id && !(await this.authz.permissionsOf(actor)).has("events:moderate_any")) {
      throw new AccessDeniedError("Sólo quien organiza este evento (o el equipo de Sin Humo) puede moderarlo.", "no_permission");
    }
    return actor;
  }

}
