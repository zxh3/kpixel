import { DatabaseSync } from "node:sqlite";

import type { SqlDatabase, SqlRow, SqlValue } from "../sql-database";

/** A SqlDatabase over Node's built-in SQLite, for testing storage logic outside Workers. */
export function nodeSqlDatabase(database = new DatabaseSync(":memory:")): SqlDatabase {
  return {
    query: <Row extends SqlRow>(sql: string, ...params: SqlValue[]) =>
      database.prepare(sql).all(...params.map(toNodeValue)) as Row[], // oxlint-disable-line typescript/no-unsafe-type-assertion -- rows match the query's columns
    transaction: (run) => {
      database.exec("BEGIN");
      try {
        const result = run();
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function toNodeValue(value: SqlValue) {
  return value instanceof ArrayBuffer ? new Uint8Array(value) : value;
}
