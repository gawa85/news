import { ValidationError } from "../domain/errors";
import type { SmokeAnalysis } from "../domain/model";
import type { ILogger, ISmokeDetector } from "../domain/ports";

/** Caso de uso 1: sacarle el humo a un texto. */
export class AnalyzeSmokeUseCase {
  constructor(
    private readonly detector: ISmokeDetector,
    private readonly logger: ILogger,
  ) {}

  async execute(input: { text: string }): Promise<SmokeAnalysis> {
    const text = input.text.trim();
    if (!text) throw new ValidationError("El texto a analizar está vacío.");

    const analysis = await this.detector.analyze(text);
    this.logger.info("Análisis de humo realizado", {
      chars: text.length,
      smokeIndex: analysis.smokeIndex,
      findings: analysis.findings.length,
    });
    return analysis;
  }
}
