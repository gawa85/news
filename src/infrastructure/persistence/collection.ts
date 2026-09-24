/**
 * Abstracción interna de persistencia: una "colección de documentos" con índices.
 *
 *   Repositorios del dominio (IUserRepository, IArticleReader...)
 *            ↓ se escriben UNA sola vez sobre
 *   IDocumentCollection<T>
 *            ↓ que implementa cada motor
 *   Memoria | SQLite | PostgreSQL | (MongoDB, DynamoDB... a futuro)
 *
 * Cada documento se guarda completo (JSON) + columnas indexadas para filtrar y ordenar.
 */
import { ConflictError } from "../../domain/errors";

export type Scalar = string | number | boolean | null | Date;

export type Condition = Scalar | { in: Scalar[] } | { gte?: Scalar; lte?: Scalar };

export interface Query {
  where?: Record<string, Condition>;
  orderBy?: { field: string; direction: "asc" | "desc" };
  limit?: number;
}

export interface IndexSpec<T> {
  type: "text" | "number";
  get: (doc: T) => Scalar;
}

export interface CollectionSchema<T> {
  name: string;
  idOf: (doc: T) => string;
  indexes: Record<string, IndexSpec<T>>;
}

export interface IDocumentCollection<T> {
  get(id: string): Promise<T | undefined>;
  find(query?: Query): Promise<T[]>;
  count(query?: Query): Promise<number>;
  /** Inserta o reemplaza. */
  upsert(doc: T): Promise<void>;
  /** Inserta; si el id ya existe lanza ConflictError (sirve para garantizar unicidad). */
  insert(doc: T): Promise<void>;
  deleteWhere(query: Query): Promise<void>;
  /**
   * Reemplaza el documento SÓLO si el guardado cumple `where` (en la misma operación).
   * Devuelve si lo reemplazó. Es la base de los reclamos atómicos: dos servidores
   * no pueden tomar el mismo trabajo.
   */
  updateIf(doc: T, where: NonNullable<Query["where"]>): Promise<boolean>;
}

export interface ICollectionFactory {
  collection<T>(schema: CollectionSchema<T>): IDocumentCollection<T>;
}

// ---------- Utilidades compartidas por todos los motores ----------

/** Valor normalizado para guardar en un índice y comparar: fechas → ISO, booleanos → 0/1. */
export function toIndexValue(v: Scalar): string | number | null {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "boolean") return v ? 1 : 0;
  return v;
}

/** JSON que preserva fechas (JSON.stringify las convertiría en texto y se perderían). */
export const codec = {
  encode(doc: unknown): string {
    return JSON.stringify(doc, function (this: Record<string, unknown>, key, value) {
      const raw = this[key];
      return raw instanceof Date ? { $date: raw.toISOString() } : value;
    });
  },
  decode<T>(text: string): T {
    return JSON.parse(text, (_k, v) =>
      v && typeof v === "object" && typeof v.$date === "string" && Object.keys(v).length === 1 ? new Date(v.$date) : v,
    ) as T;
  },
};

export function uniqueViolation(collection: string, id: string): ConflictError {
  return new ConflictError(`Ya existe un registro con id "${id}" en ${collection}.`);
}
