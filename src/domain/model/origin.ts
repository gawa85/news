import type { Article } from "./article";

export interface OriginLink {
  article: Article;
  /** Parecido con el primer artículo (0 a 1). */
  similarityToOrigin: number;
  isNearCopy: boolean;
}

/** "¿Quién lo dijo primero?": rastrea el origen de una noticia. */
export interface OriginTrace {
  target: Article;
  origin: Article;
  chain: OriginLink[];
  /** Cuántas fuentes aportan texto propio (no copias del origen). */
  independentSources: number;
  likelyPressRelease: boolean;
  /** Aviso de "falso consenso": muchas notas que en realidad son una sola fuente. */
  echoWarning?: string;
}
