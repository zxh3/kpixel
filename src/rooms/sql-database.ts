// The slice of SQLite the document store needs. Durable Objects provide it through
// ctx.storage.sql; tests provide it through node:sqlite. Keeping the store behind this
// interface lets its logic run, and be tested, outside the Workers runtime.

export type SqlValue = string | number | null | ArrayBuffer;
export type SqlRow = Record<string, SqlValue>;

export interface SqlDatabase {
  /** Runs one statement with positional `?` parameters and returns its rows, if any. */
  query<Row extends SqlRow = SqlRow>(sql: string, ...params: SqlValue[]): Row[];
  /** Runs `run` atomically: all of its statements apply, or none do. */
  transaction<T>(run: () => T): T;
}

/** Adapts a Durable Object's SQLite storage. */
export function durableObjectSqlDatabase(storage: DurableObjectStorage): SqlDatabase {
  return {
    query: <Row extends SqlRow>(sql: string, ...params: SqlValue[]) =>
      storage.sql.exec<Row>(sql, ...params).toArray(),
    transaction: (run) => storage.transactionSync(run),
  };
}
