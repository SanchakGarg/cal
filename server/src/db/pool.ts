import pg from "pg";
import { env } from "../env.ts";

// Postgres returns DATE/TIME as strings already; keep timestamps as JS Dates but
// return numerics as numbers so JSON output matches the cal.com contract.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value));

export const pool = new pg.Pool({ connectionString: env.databaseUrl, max: 10 });

export type QueryParam = unknown;

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: QueryParam[] = []
): Promise<T[]> {
  const result = await pool.query<T>(text, params as never[]);
  return result.rows;
}

export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: QueryParam[] = []
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export interface Tx {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: QueryParam[]): Promise<T[]>;
  queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: QueryParam[]): Promise<T | null>;
}

export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const tx: Tx = {
    async query(text, params = []) {
      const result = await client.query(text, params as never[]);
      return result.rows as never;
    },
    async queryOne(text, params = []) {
      const result = await client.query(text, params as never[]);
      return (result.rows[0] ?? null) as never;
    },
  };
  try {
    await client.query("BEGIN");
    const value = await fn(tx);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
