import { runner } from "node-pg-migrate";
import { stationFromEnvironment } from "./config.ts";
import { databaseClient } from "./db.ts";
import { createLogger, errorFields, errorMessage } from "./logger.ts";
import { registerStation } from "./stations/repository.ts";

const log = createLogger("bootstrap");
const migrationLog = createLogger("migrations");

async function bootstrap() {
  const station = stationFromEnvironment();
  const client = databaseClient();
  await client.connect();
  try {
    await runner({
      dbClient: client,
      dir: "migrations",
      direction: "up",
      migrationsTable: "pgmigrations",
      logger: migrationLog,
    });
    if (station) {
      await registerStation(client, station);
      log.info("Registered station", { stationId: station.id });
    }
  } finally {
    await client.end();
  }
}

bootstrap().catch((error: unknown) => {
  log.error("Database bootstrap failed", { ...errorFields(error), reason: errorMessage(error) });
  process.exitCode = 1;
});
