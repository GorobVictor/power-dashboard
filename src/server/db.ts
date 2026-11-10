import { Client, Pool } from "pg";
import { createLogger, errorFields } from "./logger.ts";

const log = createLogger("postgres");

const connectionOptions = {
  connectionTimeoutMillis: 3_000,
  statement_timeout: 5_000,
  query_timeout: 6_000,
  keepAlive: true,
};

let pool: Pool | undefined;

export function database(): Pool {
  if (!pool) {
    pool = new Pool({ ...connectionOptions, max: 5 });
    pool.on("error", (error: Error) => {
      log.error("Idle PostgreSQL connection lost", errorFields(error));
    });
  }
  return pool;
}

export function databaseClient(applicationName?: string): Client {
  return new Client({ ...connectionOptions, application_name: applicationName });
}

export async function inTransaction<T>(db: Client, work: () => Promise<T>): Promise<T> {
  await db.query("BEGIN");
  try {
    const result = await work();
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  }
}
