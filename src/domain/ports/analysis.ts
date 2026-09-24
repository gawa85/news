/**
 * Puertos de ANÁLISIS DE TEXTO.
 * Cada interfaz tiene UNA responsabilidad (SRP + ISP). Se pueden implementar con IA,
 * con reglas o con un servicio externo: los casos de uso no se enteran (DIP).
 */
import type { Article, Claim, ClaimCluster, Disagreement, SmokeAnalysis } from "../model";

export interface ISmokeDetector {
  /** Versión del algoritmo (reglas + diccionario, o modelo + instrucciones). */
  readonly version?: string;
  analyze(text: string): Promise<SmokeAnalysis>;
}

export interface IClaimExtractor {
  extract(article: Article): Promise<Claim[]>;
}

export interface IClaimClusterer {
  cluster(claims: Claim[]): Promise<ClaimCluster[]>;
}

export interface IDisagreementClassifier {
  classify(clusters: ClaimCluster[]): Promise<Disagreement[]>;
}

/** Postura de un artículo frente a un tema: -1 (muy en contra) a +1 (muy a favor). */
export interface IStanceDetector {
  stance(article: Article, topic: string): Promise<number>;
}

/** Parecido entre dos textos, de 0 a 1. Síncrono y barato: se usa muchas veces. */
export interface ITextSimilarity {
  similarity(a: string, b: string): number;
}
