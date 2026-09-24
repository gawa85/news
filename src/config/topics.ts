import type { Category, TopicDefinition } from "../domain/model";

/**
 * TAXONOMÍA INICIAL (semilla). Después se edita desde la API (`taxonomy:manage`):
 * esto sólo se carga si el tema o la categoría todavía no existen.
 */
export const SEED_CATEGORIES: Omit<Category, "active">[] = [
  { id: "economia", name: "Economía", order: 1 },
  { id: "servicios-publicos", name: "Servicios públicos", parentId: "economia", order: 1 },
  { id: "precios", name: "Precios y moneda", parentId: "economia", order: 2 },
  { id: "trabajo", name: "Trabajo", parentId: "economia", order: 3 },
  { id: "sociedad", name: "Sociedad", order: 2 },
  { id: "politica", name: "Política", order: 3 },
];

export interface SeedTopic {
  id: string;
  name: string;
  categoryId: string;
  keywords: string[];
  synonyms: string[];
  sensitive?: boolean;
}

export const SEED_TOPICS: SeedTopic[] = [
  { id: "tarifas-gas", name: "tarifas de gas", categoryId: "servicios-publicos", keywords: ["tarifa de gas", "tarifas de gas", "gas natural", "enargas", "garrafa"], synonyms: ["gas", "garrafa", "boleta de gas", "factura de gas"] },
  { id: "tarifas-luz", name: "tarifas de luz", categoryId: "servicios-publicos", keywords: ["tarifa de luz", "tarifas de luz", "energia electrica", "enre", "edenor", "edesur"], synonyms: ["luz", "electricidad", "boleta de luz"] },
  { id: "inflacion", name: "inflación", categoryId: "precios", keywords: ["inflacion", "indec", "ipc", "precios al consumidor", "canasta basica"], synonyms: ["precios", "ipc", "suba de precios"] },
  { id: "dolar", name: "dólar", categoryId: "precios", keywords: ["dolar", "tipo de cambio", "cepo", "blue", "devaluacion"], synonyms: ["dolar blue", "cotizacion", "tipo de cambio"] },
  { id: "empleo", name: "empleo", categoryId: "trabajo", keywords: ["desempleo", "desocupacion", "empleo", "salario", "paritaria", "paritarias"], synonyms: ["trabajo", "sueldos", "salarios", "paritarias"] },
  { id: "seguridad", name: "seguridad", categoryId: "sociedad", keywords: ["robo", "homicidio", "delito", "policia", "inseguridad"], synonyms: ["inseguridad", "delitos"] },
  { id: "salud", name: "salud", categoryId: "sociedad", keywords: ["hospital", "vacuna", "salud publica", "dengue", "medicamentos"], synonyms: ["hospitales", "vacunas"], sensitive: true },
  { id: "educacion", name: "educación", categoryId: "sociedad", keywords: ["escuela", "docentes", "universidad", "clases", "educacion"], synonyms: ["escuelas", "docentes", "universidades"] },
  { id: "elecciones", name: "elecciones", categoryId: "politica", keywords: ["elecciones", "candidato", "encuesta", "boleta", "comicios"], synonyms: ["votacion", "encuestas", "candidatos"], sensitive: true },
];

/** Vista simple (nombre + palabras clave) para el clasificador por palabras clave. */
export const TOPICS: TopicDefinition[] = SEED_TOPICS.map((t) => ({ name: t.name, keywords: t.keywords }));
