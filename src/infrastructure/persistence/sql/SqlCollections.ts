/**
 * Motor SQL genérico. El SQL se escribe una sola vez con `?` como parámetro y
 * sintaxis común (INSERT ... ON CONFLICT funciona en SQLite y PostgreSQL).
 * Lo que cambia entre motores está en `SqlDialect`.
 */
import {
  codec,
  toIndexValue,
  uniqueViolation,
  type CollectionSchema,
  type Condition,
  type ICollectionFactory,
  type IDocumentCollection,
  type Query,
  type Scalar,
} from "../collection";

export type SqlParam = string | number | null;
export type Row = Record<string, unknown>;

/** Conexión a una base SQL. SQLite y PostgreSQL lo implementan. */
export interface ISqlClient {
  all(sql: string, params?: SqlParam[]): Promise<Row[]>;
  /** Devuelve cuántas filas cambiaron. */
  run(sql: string, params?: SqlParam[]): Promise<number>;
  transaction<T>(work: (tx: ISqlClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface SqlDialect {
  name: string;
  jsonType: string;
  numberType: string;
  /** Cómo leer la columna JSON como texto. */
  selectJson(column: string): string;
  /** SQL que lista las columnas de una tabla (una fila por columna, campo `name`). */
  listColumnsSql: string;
  isUniqueViolation(err: unknown): boolean;
}

export class SqlCollectionFactory implements ICollectionFactory {
  constructor(
    private readonly client: ISqlClient,
    private readonly dialect: SqlDialect,
  ) {}

  collection<T>(schema: CollectionSchema<T>): SqlCollection<T> {
    return new SqlCollection(this.client, this.dialect, schema);
  }
}

export class SqlCollection<T> implements IDocumentCollection<T> {
  private readonly table: string;
  private readonly columns: string[];

  constructor(
    private readonly db: ISqlClient,
    private readonly dialect: SqlDialect,
    private readonly schema: CollectionSchema<T>,
  ) {
    assertIdentifier(schema.name);
    Object.keys(schema.indexes).forEach(assertIdentifier);
    this.table = schema.name;
    this.columns = Object.keys(schema.indexes);
  }

  /**
   * DDL idempotente: crea la tabla, agrega columnas de índice nuevas (si el esquema
   * creció), las completa para las filas existentes y crea los índices.
   */
  async migrate(): Promise<void> {
    const typeOf = (c: string) => (this.schema.indexes[c]!.type === "number" ? this.dialect.numberType : "TEXT");
    await this.db.run(
      `CREATE TABLE IF NOT EXISTS ${this.table} (id TEXT PRIMARY KEY, data ${this.dialect.jsonType} NOT NULL${this.columns.map((c) => `, ${col(c)} ${typeOf(c)}`).join("")})`,
    );

    const existing = new Set((await this.db.all(this.dialect.listColumnsSql, [this.table])).map((r) => String(r.name).toLowerCase()));
    const missing = this.columns.filter((c) => !existing.has(col(c)));
    for (const c of missing) await this.db.run(`ALTER TABLE ${this.table} ADD COLUMN ${col(c)} ${typeOf(c)}`);
    if (missing.length) for (const doc of await this.find()) await this.upsert(doc); // completa los índices nuevos

    for (const c of this.columns) {
      await this.db.run(`CREATE INDEX IF NOT EXISTS ix_${this.table}_${c} ON ${this.table} (${col(c)})`);
    }
  }

  async get(id: string) {
    const rows = await this.db.all(`SELECT ${this.dialect.selectJson("data")} AS data FROM ${this.table} WHERE id = ?`, [id]);
    return rows[0] ? codec.decode<T>(String(rows[0].data)) : undefined;
  }

  async find(q: Query = {}) {
    const { sql, params } = this.where(q);
    let stmt = `SELECT ${this.dialect.selectJson("data")} AS data FROM ${this.table}${sql}`;
    if (q.orderBy) stmt += ` ORDER BY ${this.column(q.orderBy.field)} ${q.orderBy.direction === "asc" ? "ASC" : "DESC"}`;
    if (q.limit !== undefined) stmt += ` LIMIT ${Math.max(0, Math.floor(q.limit))}`;
    const rows = await this.db.all(stmt, params);
    return rows.map((r) => codec.decode<T>(String(r.data)));
  }

  async count(q: Query = {}) {
    const { sql, params } = this.where(q);
    const rows = await this.db.all(`SELECT COUNT(*) AS n FROM ${this.table}${sql}`, params);
    return Number(rows[0]?.n ?? 0);
  }

  async upsert(doc: T) {
    const { names, params } = this.values(doc);
    const updates = names.filter((n) => n !== "id").map((n) => `${n} = excluded.${n}`);
    await this.db.run(
      `INSERT INTO ${this.table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")}) ON CONFLICT (id) DO UPDATE SET ${updates.join(", ")}`,
      params,
    );
  }

  async insert(doc: T) {
    const { names, params } = this.values(doc);
    try {
      await this.db.run(`INSERT INTO ${this.table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`, params);
    } catch (err) {
      if (this.dialect.isUniqueViolation(err)) throw uniqueViolation(this.table, this.schema.idOf(doc));
      throw err;
    }
  }

  async updateIf(doc: T, where: NonNullable<Query["where"]>) {
    const { names, params } = this.values(doc);
    const cond = this.where({ where });
    const sets = names.filter((n) => n !== "id").map((n) => `${n} = ?`);
    const changed = await this.db.run(
      `UPDATE ${this.table} SET ${sets.join(", ")} WHERE id = ?${cond.sql.replace(" WHERE ", " AND ")}`,
      [...params.slice(1), params[0]!, ...cond.params],
    );
    return changed > 0;
  }

  async deleteWhere(q: Query) {
    const { sql, params } = this.where(q);
    await this.db.run(`DELETE FROM ${this.table}${sql}`, params);
  }

  private values(doc: T) {
    const names = ["id", "data", ...this.columns.map(col)];
    const params: SqlParam[] = [
      this.schema.idOf(doc),
      codec.encode(doc),
      ...this.columns.map((c) => toIndexValue(this.schema.indexes[c]!.get(doc))),
    ];
    return { names, params };
  }

  private column(field: string): string {
    if (field === "id") return "id";
    if (!this.schema.indexes[field]) throw new Error(`"${field}" no es un índice de ${this.table}.`);
    return col(field);
  }

  private where(q: Query): { sql: string; params: SqlParam[] } {
    const parts: string[] = [];
    const params: SqlParam[] = [];
    for (const [field, cond] of Object.entries(q.where ?? {})) {
      const c = this.column(field);
      if (isObjectCondition(cond)) {
        if ("in" in cond) {
          if (cond.in.length === 0) parts.push("1 = 0");
          else {
            parts.push(`${c} IN (${cond.in.map(() => "?").join(", ")})`);
            params.push(...cond.in.map(toIndexValue));
          }
        } else {
          if (cond.gte !== undefined) (parts.push(`${c} >= ?`), params.push(toIndexValue(cond.gte)));
          if (cond.lte !== undefined) (parts.push(`${c} <= ?`), params.push(toIndexValue(cond.lte)));
        }
      } else if (cond === null) {
        parts.push(`${c} IS NULL`);
      } else {
        parts.push(`${c} = ?`);
        params.push(toIndexValue(cond));
      }
    }
    return { sql: parts.length ? ` WHERE ${parts.join(" AND ")}` : "", params };
  }
}

function isObjectCondition(c: Condition): c is { in: Scalar[] } | { gte?: Scalar; lte?: Scalar } {
  return c !== null && typeof c === "object" && !(c instanceof Date);
}

/** Las columnas indexadas llevan prefijo para no chocar con palabras reservadas. */
const col = (name: string) => `ix_${name}`.toLowerCase();

function assertIdentifier(s: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) throw new Error(`Identificador SQL inválido: ${s}`);
}
