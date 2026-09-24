import type { Article, Outlet } from "../../domain/model";
import type { ISourceSelectionPolicy } from "../../domain/ports";

/**
 * Evita que un solo medio (o un solo tipo de medio) domine la comparación:
 * como máximo N artículos por medio, y descarta artículos de medios no registrados.
 */
export class MaxPerOutletSelectionPolicy implements ISourceSelectionPolicy {
  constructor(private readonly maxPerOutlet = 2) {}

  select(articles: Article[], outlets: Outlet[]): Article[] {
    const known = new Set(outlets.map((o) => o.id));
    const count = new Map<string, number>();
    return [...articles]
      .sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime())
      .filter((a) => {
        if (!known.has(a.outletId)) return false;
        const n = count.get(a.outletId) ?? 0;
        if (n >= this.maxPerOutlet) return false;
        count.set(a.outletId, n + 1);
        return true;
      });
  }
}
