import type { Article } from "../../domain/model";
import type { IStanceDetector } from "../../domain/ports";
import { polarity } from "./text";

/** Postura aproximada por léxico. Reemplazable por un detector con IA. */
export class LexiconStanceDetector implements IStanceDetector {
  async stance(article: Article, _topic: string): Promise<number> {
    return polarity(`${article.title}. ${article.body}`);
  }
}
