import type { Pool, PoolClient } from "pg";
import type { ISqlClient, Row, SqlDialect, SqlParam } from "./SqlCollections";

export const postgresDialect: SqlDialect = {
  name: "postgresql",
  jsonType: "JSONB",
  numberType: "DOUBLE PRECISION",
  selectJson: (c) => `${c}::text`,
  listColumnsSql: "SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?",
  isUniqueViolation: (e) => typeof e === "object" && e !== null && (e as { code?: string }).code === "23505",
};

/** Convierte los `?` del SQL común en `$1, $2...` de PostgreSQL. */
export function toPgPlaceholders(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

type Queryable = Pick<Pool, "query"> | PoolClient;

class PgExecutor implements ISqlClient {
  constructor(
    protected readonly target: Queryable,
    private readonly inTransaction: boolean,
    private readonly pool?: Pool,
  ) {}

  async all(sql: string, params: SqlParam[] = []): Promise<Row[]> {
    return (await this.target.query(toPgPlaceholders(sql), params)).rows as Row[];
  }

  async run(sql: string, params: SqlParam[] = []): Promise<number> {
    return (await this.target.query(toPgPlaceholders(sql), params)).rowCount ?? 0;
  }

  async transaction<T>(work: (tx: ISqlClient) => Promise<T>): Promise<T> {
    if (this.inTransaction || !this.pool) return work(this); // ya estamos dentro de una
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(new PgExecutor(client, true));
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (this.pool) await this.pool.end();
  }
}

/** PostgreSQL con pool de conexiones (paquete `pg`). */
export class PostgresClient extends PgExecutor {
  constructor(connectionString: string, maxConnections = 10) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool: PgPool } = require("pg") as typeof import("pg");
    const pool = new PgPool({ connectionString, max: maxConnections });
    super(pool, false, pool);
  }
}
