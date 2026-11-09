import type { CollectorStation } from "./stations/types.ts";

export function positiveInteger(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 2_147_483_647) {
    throw new Error(`${name} must be a positive integer up to 2147483647`);
  }
  return number;
}

export function stationFromEnvironment(): CollectorStation | null {
  const id = process.env.STATION_ID?.trim();
  const name = process.env.STATION_NAME?.trim();
  const model = process.env.STATION_MODEL?.trim();
  const deviceId = process.env.STATION_DEVICE_ID?.trim().toLowerCase();
  const bleMac = process.env.STATION_BLE_MAC?.trim().toLowerCase();

  if (!id && !name && !model && !deviceId && !bleMac) return null;
  if (!id || !name || !model || !deviceId || !bleMac) {
    throw new Error("Set all five STATION_* variables to register a station");
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(id) || !/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(bleMac)) {
    throw new Error("Invalid STATION_ID or STATION_BLE_MAC");
  }
  return { id, name, model, deviceId, bleMac };
}
