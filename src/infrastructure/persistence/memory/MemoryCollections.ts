import {
  codec,
  toIndexValue,
  uniqueViolation,
  type CollectionSchema,
  type Condition,
  type ICollectionFactory,
  type IDocumentCollection,
  type Query,
} from "../collection";

type Tables = Map<string, Map<string, string>>;

/**
 * Motor en memoria. Guarda los documentos serializados (como una base real):
 * modificar un objeto leído no cambia lo guardado.
 */
export class MemoryCollectionFactory implements ICollectionFactory {
  readonly tables: Tables = new Map();

  collection<T>(schema: CollectionSchema<T>): IDocumentCollection<T> {
    if (!this.tables.has(schema.name)) this.tables.set(schema.name, new Map());
    return new MemoryCollection(this.tables.get(schema.name)!, schema);
  }

  snapshot(): Tables {
    return new Map([...this.tables].map(([k, v]) => [k, new Map(v)]));
  }

  /** Restaura EN EL LUGAR: las colecciones ya creadas apuntan a estos mismos Map. */
  restore(s: Tables): void {
    for (const [name, rows] of this.tables) {
      rows.clear();
      s.get(name)?.forEach((v, k) => rows.set(k, v));
    }
  }
}

class MemoryCollection<T> implements IDocumentCollection<T> {
  constructor(
    private readonly rows: Map<string, string>,
    private readonly schema: CollectionSchema<T>,
  ) {}

  async get(id: string) {
    const raw = this.rows.get(id);
    return raw === undefined ? undefined : codec.decode<T>(raw);
  }

  async find(q: Query = {}) {
    let docs = [...this.rows.values()].map((r) => codec.decode<T>(r)).filter((d) => this.matches(d, q));
    if (q.orderBy) {
      const { field, direction } = q.orderBy;
      const sign = direction === "asc" ? 1 : -1;
      docs.sort((a, b) => {
        const x = this.value(a, field);
        const y = this.value(b, field);
        return x === y ? 0 : (x ?? "") < (y ?? "") ? -sign : sign;
      });
    }
    if (q.limit !== undefined) docs = docs.slice(0, q.limit);
    return docs;
  }

  async count(q: Query = {}) {
    return (await this.find({ where: q.where })).length;
  }

  async upsert(doc: T) {
    this.rows.set(this.schema.idOf(doc), codec.encode(doc));
  }

  async insert(doc: T) {
    const id = this.schema.idOf(doc);
    if (this.rows.has(id)) throw uniqueViolation(this.schema.name, id);
    this.rows.set(id, codec.encode(doc));
  }

  async updateIf(doc: T, where: NonNullable<Query["where"]>) {
    const id = this.schema.idOf(doc);
    const raw = this.rows.get(id);
    if (raw === undefined || !this.matches(codec.decode<T>(raw), { where })) return false;
    this.rows.set(id, codec.encode(doc));
    return true;
  }

  async deleteWhere(q: Query) {
    for (const [id, raw] of [...this.rows]) if (this.matches(codec.decode<T>(raw), q)) this.rows.delete(id);
  }

  private value(doc: T, field: string) {
    if (field === "id") return this.schema.idOf(doc);
    const idx = this.schema.indexes[field];
    if (!idx) throw new Error(`"${field}" no es un índice de ${this.schema.name}.`);
    return toIndexValue(idx.get(doc));
  }

  private matches(doc: T, q: Query): boolean {
    return Object.entries(q.where ?? {}).every(([field, cond]) => test(this.value(doc, field), cond));
  }
}

function test(v: string | number | null, cond: Condition): boolean {
  if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
    if ("in" in cond) return cond.in.map(toIndexValue).includes(v);
    if (v === null) return false;
    const { gte, lte } = cond as { gte?: Parameters<typeof toIndexValue>[0]; lte?: Parameters<typeof toIndexValue>[0] };
    if (gte !== undefined && v < toIndexValue(gte)!) return false;
    if (lte !== undefined && v > toIndexValue(lte)!) return false;
    return true;
  }
  return v === toIndexValue(cond);
}
