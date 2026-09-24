/**
 * RIESGO DE DIFAMACIÓN al publicar sobre medios o personas.
 *
 * No decide si algo es difamatorio (eso lo decide un juez): marca los textos que
 * conviene que revise una persona ANTES de publicarlos. Lo más riesgoso es atribuir
 * un delito, una intención (mentir a sabiendas) o una motivación económica oculta a
 * alguien identificable, en lugar de describir lo verificado ("la nota dice X; el dato
 * oficial es Y").
 */
export type RiskLevel = "low" | "medium" | "high";

export interface DefamationAssessment {
  level: RiskLevel;
  reasons: string[];
  /** Cómo reescribirlo con menos riesgo. */
  suggestions: string[];
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Imputar delitos o conductas deshonestas. */
const CRIME = /\b(miente|mintio|mentiros[oa]s?|mentira deliberada|corrupt[oa]s?|estaf\w*|delito|delincuente|coima\w*|soborn\w*|lavado|fraude|ensobrad[oa]s?|comprad[oa]s? por|pagad[oa]s? por|a sueldo de|operacion de prensa|opereta|sicari[oa]s? mediatic[oa]s?|fake news|periodista trucho|vendid[oa]s?)\b/;
/** Absolutos que generalizan. */
const ABSOLUTE = /\b(siempre miente|nunca dice la verdad|todo lo que publica|es un medio falso|no es periodismo)\b/;
/** Juicios de valor fuertes. */
const EVALUATIVE = /\b(manipula\w*|propaganda|desinforma\w*|basura|panfleto|operador(es)? politic\w*)\b/;
/** Marcas de que se describe algo verificado y citado. */
const ATTRIBUTION = /\b(segun|de acuerdo con|el dato oficial|la resolucion|el informe|fuente:|verificamos|en nuestra verificacion)\b/;

export function assessDefamationRisk(text: string, named: string[]): DefamationAssessment {
  const t = norm(text);
  const targets = named.map(norm).filter((n) => n.length >= 3 && t.includes(n));
  const reasons: string[] = [];
  const suggestions: string[] = [];
  if (!targets.length) return { level: "low", reasons, suggestions };

  const crime = t.match(CRIME)?.[0];
  const absolute = t.match(ABSOLUTE)?.[0];
  const evaluative = t.match(EVALUATIVE)?.[0];
  if (crime) {
    reasons.push(`Atribuye una conducta deshonesta o un delito ("${crime}") a alguien identificable (${targets.join(", ")}).`);
    suggestions.push("Describí el hecho verificado sin atribuir intención: \"La nota afirma X; el dato oficial (fuente) es Y\".");
  }
  if (absolute) {
    reasons.push(`Generaliza ("${absolute}") sobre ${targets.join(", ")}.`);
    suggestions.push("Limitá la afirmación a las notas analizadas, con período y cantidad.");
  }
  const unsupported = !!evaluative && !ATTRIBUTION.test(t);
  if (unsupported) {
    reasons.push(`Juicio de valor fuerte ("${evaluative}") sin citar evidencia.`);
    suggestions.push("Presentalo como opinión fundada y citá la metodología y los datos.");
  }
  const level: RiskLevel = crime || absolute ? "high" : unsupported ? "medium" : "low";
  if (level !== "low") suggestions.push("Recordá mencionar el derecho a réplica del medio.");
  return { level, reasons, suggestions };
}
