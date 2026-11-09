import { setTimeout as delay } from "node:timers/promises";
import { positiveInteger } from "./config.ts";
import { databaseClient } from "./db.ts";
import { collectStation } from "./stations/collector.ts";
import { listEnabledStations } from "./stations/repository.ts";

async function enabledStations() {
  const db = databaseClient();
  await db.connect();
  try {
    return await listEnabledStations(db);
  } finally {
    await db.end();
  }
}

async function run(signal: AbortSignal) {
  const interval = positiveInteger("POLL_INTERVAL_MS", 1_000);
  const adapter = process.env.BLE_ADAPTER ?? "hci0";
  if (!/^hci\d+$/.test(adapter)) throw new Error("BLE_ADAPTER must be an adapter name such as hci0");

  while (!signal.aborted) {
    const stations = await enabledStations();
    if (stations.length) {
      console.info("Starting Marstek worker", { adapter, interval, stations: stations.length });
      await Promise.all(stations.map((station) => collectStation(station, adapter, interval, signal)));
      return;
    }
    console.info("No enabled Marstek stations. Checking again in 30 seconds");
    await delay(30_000, undefined, { signal });
  }
}

const shutdown = new AbortController();
process.once("SIGINT", () => shutdown.abort());
process.once("SIGTERM", () => shutdown.abort());

run(shutdown.signal).catch((error: Error) => {
  if (shutdown.signal.aborted) return;
  console.error("Marstek worker failed", error.message);
  shutdown.abort();
  process.exitCode = 1;
});
