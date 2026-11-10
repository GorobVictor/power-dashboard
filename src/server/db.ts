import { Client, Pool } from "pg";

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
      console.error("Idle PostgreSQL connection lost", error.name);
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

export function databaseErrorMessage(error: unknown): string {
  if (error instanceof AggregateError && error.errors.length) {
    return error.errors.map(databaseErrorMessage).join(", ");
  }
  return error instanceof Error ? error.message || error.name : String(error);
}
