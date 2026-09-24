import type { SmokeType } from "../domain/model";

/**
 * MODO APRENDIZAJE: qué mirar para reconocer cada tipo de humo (se usa en las explicaciones).
 * Lenguaje simple: está pensado para chicos y chicas de secundaria.
 */
export const SMOKE_TIPS: Record<SmokeType, string> = {
  inflated_adjective: "Mirá los adjetivos exagerados (\"histórico\", \"sin precedentes\", \"el mejor\"): no dicen ningún dato.",
  vague_promise: "Una promesa sin fecha, sin monto y sin cómo (\"vamos a trabajar para…\") no se puede controlar.",
  filler: "Frases de relleno (\"cabe destacar\", \"en este sentido\") ocupan lugar pero no agregan nada.",
  alarmism: "Si busca asustarte (\"catástrofe\", \"colapso\", \"alerta máxima\"), frená y buscá el dato.",
  marketing: "Si te quiere vender algo (\"oferta exclusiva\", \"no quieren que sepas\"), desconfiá.",
  unsourced_claim: "¿Quién lo dice? \"Dicen los expertos\" o \"fuentes seguras\" sin nombre no es una fuente.",
  chain_call: "\"Reenviá a todos\" es la marca de las cadenas: casi nunca traen información confiable.",
};

export const CLEAN_TIP = "Tiene datos concretos (números, fechas, quién lo informa) y no exagera: es información, no humo.";
