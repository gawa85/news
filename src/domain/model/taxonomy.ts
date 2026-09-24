/**
 * TEMAS Y CATEGORÍAS: la taxonomía editable del producto.
 * Categoría = agrupador jerárquico (Economía › Servicios públicos).
 * Tema = lo que se clasifica, se sigue, se compara y se cuenta (Tarifas de gas).
 * Los temas tienen palabras clave (para clasificar notas) y sinónimos (para entender
 * lo que escribe la gente: "gas", "garrafa" → Tarifas de gas).
 */
export interface Category {
  id: string;
  name: string;
  parentId?: string;
  description?: string;
  order: number;
  active: boolean;
}

export interface Topic {
  id: string;
  /** Nombre que se muestra y que llevan las notas clasificadas. */
  name: string;
  categoryId: string;
  keywords: string[];
  synonyms: string[];
  /** Tema sensible (política, elecciones, salud): lo usan reglas especiales (vedas, revisión). */
  sensitive: boolean;
  /** Países donde aplica (vacío = todos). */
  countries: string[];
  active: boolean;
  updatedAt: Date;
  updatedBy: string;
}

/** "Economía › Servicios públicos" (de la raíz a la categoría). */
export function categoryPath(categoryId: string, categories: Category[]): Category[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const path: Category[] = [];
  const seen = new Set<string>();
  for (let c = byId.get(categoryId); c && !seen.has(c.id); c = c.parentId ? byId.get(c.parentId) : undefined) {
    seen.add(c.id);
    path.unshift(c);
  }
  return path;
}

/** Ids de una categoría y todas sus descendientes. */
export function categoryAndDescendants(categoryId: string, categories: Category[]): Set<string> {
  const out = new Set([categoryId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of categories) if (c.parentId && out.has(c.parentId) && !out.has(c.id)) (out.add(c.id), (grew = true));
  }
  return out;
}

export const slugify = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
