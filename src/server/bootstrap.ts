import { runner } from "node-pg-migrate";
import { stationFromEnvironment } from "./config.ts";
import { databaseClient, databaseErrorMessage } from "./db.ts";
import { registerStation } from "./stations/repository.ts";

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
    });
    if (station) {
      await registerStation(client, station);
      console.info("Registered station", station.id);
    }
  } finally {
    await client.end();
  }
}

bootstrap().catch((error: unknown) => {
  console.error("Database bootstrap failed", databaseErrorMessage(error));
  process.exitCode = 1;
});
