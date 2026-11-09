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

export function databaseClient(): Client {
  return new Client(connectionOptions);
}
