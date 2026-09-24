import type { PublishResult, ReplyDraft, ReplyStatus, ReplyTarget, ResponseContent } from "../model";

/**
 * Publica una respuesta en un destino concreto: hilo de mail, chat, foro, página.
 * Cada integración (Discourse, WordPress, WhatsApp, SMTP, webhook de un sitio propio)
 * es una clase que implementa esta interfaz. Cada una dibuja el contenido en su formato.
 */
export interface IReplyPublisher {
  supports(target: ReplyTarget): boolean;
  publish(target: ReplyTarget, content: ResponseContent): Promise<PublishResult>;
}

export interface IReplyDraftRepository {
  findById(id: string): Promise<ReplyDraft | undefined>;
  findByStatus(status: ReplyStatus, limit: number): Promise<ReplyDraft[]>;
  findPublishedBetween(from: Date, to: Date): Promise<ReplyDraft[]>;
  save(draft: ReplyDraft): Promise<void>;
}
