export type SmokeType =
  | "inflated_adjective"
  | "vague_promise"
  | "filler"
  | "alarmism"
  | "marketing"
  | "unsourced_claim"
  | "chain_call"
  | "ai_manipulation";

export const SMOKE_LABELS: Record<SmokeType, string> = {
  inflated_adjective: "Adjetivo inflado",
  vague_promise: "Promesa vaga",
  filler: "Relleno",
  alarmism: "Alarmismo",
  marketing: "Lenguaje de marketing",
  unsourced_claim: "Afirmación sin fuente",
  chain_call: "Pedido de reenvío",
  ai_manipulation: "Intento de manipular a la IA",
};

export interface SmokeFinding {
  type: SmokeType;
  excerpt: string;
  explanation: string;
}

export interface SmokeAnalysis {
  /** 0 = sin humo, 100 = todo humo. */
  smokeIndex: number;
  facts: string[];
  findings: SmokeFinding[];
  cleanVersion: string;
}
