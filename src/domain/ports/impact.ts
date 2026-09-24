import type { ImpactMetrics, ImpactSnapshot, ReplyDraft, TrackedLink } from "../model";

/** Mide el impacto de una respuesta en SU destino (foro, página, chat, mail). Uno por destino. */
export interface IImpactCollector {
  supports(draft: ReplyDraft): boolean;
  collect(draft: ReplyDraft): Promise<ImpactMetrics>;
}

export interface IImpactRepository {
  save(snapshot: ImpactSnapshot): Promise<void>;
  /** Última medición de cada respuesta. */
  latestFor(replyIds: string[]): Promise<ImpactSnapshot[]>;
}

export interface ITrackedLinkRepository {
  findByCode(code: string): Promise<TrackedLink | undefined>;
  findByReply(replyId: string): Promise<TrackedLink[]>;
  save(link: TrackedLink): Promise<void>;
}
