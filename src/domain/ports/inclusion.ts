import type {
  Classroom,
  ClassroomMember,
  FeatureFlag,
  LearningState,
  QuizAttempt,
  QuizItem,
  ResponseContent,
  Ticket,
} from "../model";

export interface ILearningRepository {
  findItems(): Promise<QuizItem[]>;
  saveItem(i: QuizItem): Promise<void>;
  findClassroom(id: string): Promise<Classroom | undefined>;
  findClassroomByCode(code: string): Promise<Classroom | undefined>;
  findClassroomsByTeacher(teacherId: string): Promise<Classroom[]>;
  saveClassroom(c: Classroom): Promise<void>;
  /** ConflictError si ya es miembro. */
  addMember(m: ClassroomMember): Promise<void>;
  findMembers(classroomId: string): Promise<ClassroomMember[]>;
  findMemberships(userId: string): Promise<ClassroomMember[]>;
  addAttempt(a: QuizAttempt): Promise<void>;
  findAttempts(filter: { playerId?: string; classroomId?: string }): Promise<QuizAttempt[]>;
  getState(playerId: string): Promise<LearningState | undefined>;
  saveState(s: LearningState): Promise<void>;
  deletePlayer(userId: string): Promise<void>;
}

/** Reescribe una respuesta en LECTURA FÁCIL (frases cortas, palabras comunes, sin jerga). */
export interface IPlainLanguageRewriter {
  rewrite(c: ResponseContent): Promise<ResponseContent>;
}

/** Texto a voz (Google, Azure, ElevenLabs…). */
export interface ITextToSpeech {
  readonly id: string;
  synthesize(text: string, language: string): Promise<{ data: Buffer; mime: string; seconds?: number }>;
}

/** Audio a texto (Whisper, Groq, Google, un servidor propio…). */
export interface ISpeechToText {
  readonly id: string;
  transcribe(audio: { data: Buffer; mime: string }, language: string): Promise<{ text: string; seconds?: number }>;
}

/** Baja un archivo recibido por un canal (la nota de voz de WhatsApp o Telegram). */
export interface IInboundMediaFetcher {
  readonly channel: import("../model").ChannelType;
  /** Rechaza (ValidationError) si el archivo supera `maxBytes`. */
  fetch(ref: string, maxBytes: number): Promise<{ data: Buffer; mime: string }>;
}

/** Archivos propios con link firmado y vencimiento (audios de respuesta). */
export interface IMediaStore {
  put(data: Buffer, mime: string, ttlSeconds: number): Promise<{ id: string; url: string }>;
  get(id: string, signature: string, expires: number): Promise<{ data: Buffer; mime: string } | undefined>;
}

export interface ITicketRepository {
  save(t: Ticket): Promise<void>;
  findById(id: string): Promise<Ticket | undefined>;
  findByRequester(userId: string): Promise<Ticket[]>;
  findOpen(): Promise<Ticket[]>;
}

/** Mesa de ayuda externa (Zendesk, Freshdesk…) opcional: se le copian los tickets. */
export interface ISupportDesk {
  readonly id: string;
  push(t: Ticket): Promise<{ externalId?: string }>;
}

export interface IFeatureFlagRepository {
  find(key: string): Promise<FeatureFlag | undefined>;
  findAll(): Promise<FeatureFlag[]>;
  save(f: FeatureFlag): Promise<void>;
}

export interface FlagContext {
  userId?: string;
  organizationId?: string;
  planId?: string;
  country?: string;
}

export interface IFeatureFlags {
  isEnabled(key: string, ctx: FlagContext): Promise<boolean>;
}

export interface IConsentRepository {
  save(c: import("../model").ConsentRecord): Promise<void>;
  findByUser(userId: string): Promise<import("../model").ConsentRecord[]>;
  deleteByUser(userId: string): Promise<void>;
}
