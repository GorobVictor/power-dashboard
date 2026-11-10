import { setTimeout as delay } from "node:timers/promises";
import { positiveInteger, telegramFromEnvironment } from "./config.ts";
import { databaseClient, databaseErrorMessage } from "./db.ts";
import { collectOutageSchedules } from "./outages/collector.ts";
import { collectStation } from "./stations/collector.ts";
import { listEnabledStations } from "./stations/repository.ts";
import type { BatteryNotificationOptions } from "./telegram/battery.ts";
import { deliverTelegramNotifications } from "./telegram/worker.ts";

async function enabledStations() {
  const db = databaseClient();
  await db.connect();
  try {
    return await listEnabledStations(db);
  } finally {
    await db.end();
  }
}

async function runMarstek(signal: AbortSignal, notifications?: BatteryNotificationOptions) {
  const interval = positiveInteger("POLL_INTERVAL_MS", 1_000);
  const platform = process.platform === "darwin" ? "macos" : process.platform;
  const host = process.env.BLE_HOST_OS || platform;
  if (host !== platform || (host !== "macos" && host !== "linux")) {
    throw new Error("BLE_HOST_OS must match the worker host: macos or linux");
  }
  while (!signal.aborted) {
    const stations = await enabledStations();
    signal.throwIfAborted();
    if (stations.length) {
      const macos = host === "macos" ? await import("./marstek/macos.ts") : null;
      const connect = macos?.connectMacos
        ?? (await import("./marstek/bluez.ts")).bluezConnector(process.env.BLE_ADAPTER || "hci0");
      try {
        console.info("Starting Marstek worker", { host, interval, stations: stations.length });
        await Promise.all(stations.map((station) => collectStation(station, connect, interval, signal, notifications)));
      } finally {
        macos?.stopMacos();
      }
      return;
    }
    console.info("No enabled Marstek stations. Checking again in 30 seconds");
    await delay(30_000, undefined, { signal });
  }
}

const shutdown = new AbortController();
process.once("SIGINT", () => shutdown.abort());
process.once("SIGTERM", () => shutdown.abort());

let telegram: ReturnType<typeof telegramFromEnvironment> = null;
try {
  telegram = telegramFromEnvironment();
} catch (error) {
  console.warn("Telegram notifications disabled", databaseErrorMessage(error));
}

const collectors = [
  runMarstek(shutdown.signal, telegram ?? undefined),
  collectOutageSchedules(shutdown.signal, telegram?.outageQueue),
];
if (telegram) collectors.push(deliverTelegramNotifications(telegram, shutdown.signal));
try {
  await Promise.all(collectors);
} catch (error) {
  if (!shutdown.signal.aborted) {
    console.error("Worker failed", databaseErrorMessage(error));
    shutdown.abort();
    process.exitCode = 1;
  }
  await Promise.allSettled(collectors);
}
