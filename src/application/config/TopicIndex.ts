import type { Topic } from "../../domain/model";
import type { IClock, ITaxonomyRepository, ITopicClassifier, ITopicResolver } from "../../domain/ports";
import { topicKey } from "./Taxonomy";

/**
 * Índice de temas en memoria, leído de la base (con vencimiento corto y se invalida cuando
 * alguien edita la taxonomía). Hace dos cosas:
 *  - resolve(): entiende lo que escribe la gente (nombre, id o sinónimo → tema);
 *  - classify(): asigna tema a una nota por palabras clave (el que más coincide).
 */
export class TopicIndex implements ITopicResolver, ITopicClassifier {
  private cache?: { at: number; topics: Topic[]; byKey: Map<string, Topic> };

  constructor(
    private readonly repo: ITaxonomyRepository,
    private readonly clock: IClock,
    private readonly ttlMs = 60_000,
  ) {}

  invalidate(): void {
    this.cache = undefined;
  }

  async resolve(text: string): Promise<Topic | undefined> {
    const { byKey } = await this.load();
    return byKey.get(topicKey(text));
  }

  async classify(text: string): Promise<string | undefined> {
    const t = ` ${topicKey(text)}`;
    let best: { name: string; hits: number } | undefined;
    for (const topic of (await this.load()).topics) {
      const hits = topic.keywords.filter((k) => t.includes(` ${topicKey(k)}`)).length;
      if (hits > 0 && (!best || hits > best.hits)) best = { name: topic.name, hits };
    }
    return best?.name;
  }

  async all(): Promise<Topic[]> {
    return (await this.load()).topics;
  }

  private async load() {
    const now = this.clock.now().getTime();
    if (this.cache && now - this.cache.at < this.ttlMs) return this.cache;
    const topics = (await this.repo.findTopics()).filter((t) => t.active);
    const byKey = new Map<string, Topic>();
    for (const t of topics) for (const k of [t.id, t.name, ...t.synonyms]) if (!byKey.has(topicKey(k))) byKey.set(topicKey(k), t);
    this.cache = { at: now, topics, byKey };
    return this.cache;
  }
}
