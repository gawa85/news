import type {
  Campaign,
  CampaignAlly,
  CampaignDelivery,
  CampaignPiece,
  CampaignPieceKind,
  Narrative,
  Perspective,
  PerspectiveTarget,
  PerspectiveVote,
  Room,
  RoomEvent,
  RoomMessage,
} from "../model";

export interface INarrativeRepository {
  findById(id: string): Promise<Narrative | undefined>;
  findActiveSince(date: Date): Promise<Narrative[]>;
  findTop(since: Date, limit: number): Promise<Narrative[]>;
  save(n: Narrative): Promise<void>;
}

export interface ICampaignRepository {
  findById(id: string): Promise<Campaign | undefined>;
  findByStatus(status: Campaign["status"]): Promise<Campaign[]>;
  save(c: Campaign): Promise<void>;
  findAllies(campaignId: string): Promise<CampaignAlly[]>;
  saveAlly(a: CampaignAlly): Promise<void>;
  recordDelivery(d: CampaignDelivery): Promise<void>;
  findDeliveries(campaignId: string): Promise<CampaignDelivery[]>;
}

/**
 * Canal PROPIO de difusión de una campaña: seguidores que aceptaron avisos del tema,
 * un canal de Telegram de la organización, su sitio… Nunca mensajes a desconocidos.
 */
export interface ICampaignChannel {
  readonly id: string;
  readonly label: string;
  /** Qué tipos de pieza publica (un canal de texto no publica tarjetas, etc.). */
  readonly accepts: CampaignPieceKind[];
  publish(campaign: Campaign, piece: CampaignPiece, pieceIndex: number): Promise<{ ok: boolean; reach: number; externalId?: string; error?: string }>;
}

/** Genera piezas gráficas (tarjetas) a partir del mensaje. */
export interface IAssetGenerator {
  card(input: { title: string; body: string; footer: string }): Promise<{ contentType: string; data: string }>;
}

export interface IPerspectiveRepository {
  findById(id: string): Promise<Perspective | undefined>;
  findByTarget(target: PerspectiveTarget): Promise<Perspective[]>;
  save(p: Perspective): Promise<void>;
  /** Voto único por persona: devuelve el voto anterior si existía. */
  vote(v: PerspectiveVote): Promise<PerspectiveVote | undefined>;
}

export interface IRoomRepository {
  findById(id: string): Promise<Room | undefined>;
  findByOrganization(organizationId: string): Promise<Room[]>;
  save(r: Room): Promise<void>;
  addMessage(m: RoomMessage): Promise<void>;
  saveMessage(m: RoomMessage): Promise<void>;
  findMessage(id: string): Promise<RoomMessage | undefined>;
  history(roomId: string, limit: number): Promise<RoomMessage[]>;
  lastMessageBy(roomId: string, userId: string): Promise<RoomMessage | undefined>;
}

/**
 * Transporte en tiempo real. En un solo servidor, en memoria; con varios,
 * detrás de esta interfaz va Redis pub/sub u otro bus.
 */
export interface IRealtimeTransport {
  publish(roomId: string, event: RoomEvent): void;
  /** Suscribe a un usuario a una sala; devuelve cómo desuscribirse. */
  subscribe(roomId: string, userId: string, listener: (e: RoomEvent) => void): () => void;
  present(roomId: string): string[];
}
