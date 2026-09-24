import type { Article, Claim, InjectionAssessment, SmokeAnalysis } from "../../domain/model";
import { INJECTION_LABELS } from "../../domain/model";
import type { IClaimExtractor, IPromptInjectionDetector, ISmokeDetector, ITextSanitizer } from "../../domain/ports";
import { assessInjection, DEFAULT_INJECTION_THRESHOLDS, hiddenTextSignals, type InjectionThresholds } from "../../domain/rules/promptInjection";

export interface SafetyCheck {
  /** Texto limpio (sin invisibles): es el que puede ir a la IA. */
  text: string;
  assessment: InjectionAssessment;
}

/**
 * GUARDIÁN DE INSTRUCCIONES ESCONDIDAS: todo contenido de terceros pasa por acá antes de
 * llegar a la IA. Limpia, junta las señales de todos los detectores (reglas, IA…) y decide
 * el riesgo. No sabe qué detectores hay ni cómo funcionan (DIP): se inyectan.
 */
export class PromptSafetyGuard {
  constructor(
    private readonly sanitizer: ITextSanitizer,
    private readonly detectors: IPromptInjectionDetector[],
    private readonly thresholds: InjectionThresholds = DEFAULT_INJECTION_THRESHOLDS,
    /** Métricas / registro (qué se detectó y dónde). */
    private readonly onDetected?: (a: InjectionAssessment, where: string) => void,
  ) {}

  async check(text: string, where = "content"): Promise<SafetyCheck> {
    const clean = this.sanitizer.sanitize(text);
    // Lo escondido también se inspecciona: es justo lo que no se ve.
    const inspected = clean.hidden ? `${clean.text}\n${clean.hidden}` : clean.text;
    const found = await Promise.all(this.detectors.map((d) => d.inspect(inspected).catch(() => [])));
    const assessment = assessInjection([...hiddenTextSignals(clean), ...found.flat()], this.thresholds);
    if (assessment.risk !== "none") this.onDetected?.(assessment, where);
    return { text: clean.text, assessment };
  }
}

/**
 * Detector de humo protegido (decorador, OCP): el texto limpio va al detector principal;
 * con riesgo ALTO no va a la IA sino al detector de respaldo (reglas), y el intento de
 * manipulación se informa como humo: es una señal fuerte de que el texto busca engañar.
 */
export class GuardedSmokeDetector implements ISmokeDetector {
  readonly version?: string;

  constructor(
    private readonly primary: ISmokeDetector,
    private readonly fallback: ISmokeDetector,
    private readonly guard: PromptSafetyGuard,
  ) {
    this.version = primary.version;
  }

  async analyze(text: string): Promise<SmokeAnalysis> {
    const { text: clean, assessment } = await this.guard.check(text, "smoke");
    if (assessment.risk !== "high") return this.primary.analyze(clean);
    const r = await this.fallback.analyze(clean);
    const top = assessment.signals[0]!;
    return {
      ...r,
      smokeIndex: Math.max(r.smokeIndex, 80),
      findings: [
        {
          type: "ai_manipulation",
          excerpt: top.excerpt,
          explanation: `${INJECTION_LABELS[top.type]}: el texto trae instrucciones para engañar a una IA que lo analice. Se analizó sin IA.`,
        },
        ...r.findings,
      ],
    };
  }
}

/**
 * Extractor de afirmaciones protegido: una nota web también puede traer instrucciones
 * (a veces en texto invisible). Con riesgo alto se extrae por reglas.
 */
export class GuardedClaimExtractor implements IClaimExtractor {
  constructor(
    private readonly primary: IClaimExtractor,
    private readonly fallback: IClaimExtractor,
    private readonly guard: PromptSafetyGuard,
  ) {}

  async extract(article: Article): Promise<Claim[]> {
    const { text, assessment } = await this.guard.check(`${article.title}\n\n${article.body}`, "article");
    const [title, ...rest] = text.split("\n\n");
    const clean = { ...article, title: title ?? "", body: rest.join("\n\n") };
    return assessment.risk === "high" ? this.fallback.extract(clean) : this.primary.extract(clean);
  }
}
