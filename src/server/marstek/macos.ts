import { setTimeout as delay } from "node:timers/promises";
import noble, { type Peripheral } from "@stoprocent/noble";
import { abortable } from "./abort.ts";
import { requestFrame, type BleConnection, type ConnectStation } from "./client.ts";
import { DEVICE_INFO, verifyDevice } from "./protocol.ts";

async function discover(signal: AbortSignal): Promise<Peripheral[]> {
  signal.throwIfAborted();
  await abortable(noble.waitForPoweredOnAsync(5_000), signal);
  const found = new Map<string, Peripheral>();
  const onDiscover = (peripheral: Peripheral) => {
    if (peripheral.advertisement.localName?.startsWith("MST_VNSE3_")) {
      found.set(peripheral.id, peripheral);
    }
  };
  noble.on("discover", onDiscover);
  try {
    await abortable(noble.startScanningAsync(), AbortSignal.any([signal, AbortSignal.timeout(3_000)]));
    await delay(6_000, undefined, { signal });
    return [...found.values()];
  } finally {
    noble.off("discover", onDiscover);
    await abortable(noble.stopScanningAsync(), AbortSignal.timeout(1_000)).catch(() => {});
  }
}

async function openPeripheral(peripheral: Peripheral, parent: AbortSignal): Promise<BleConnection> {
  const disconnected = new AbortController();
  const onDisconnect = () => disconnected.abort(new Error("Marstek BLE device disconnected"));
  const signal = AbortSignal.any([parent, disconnected.signal, AbortSignal.timeout(8_000)]);
  const close = async () => {
    peripheral.off("disconnect", onDisconnect);
    if (peripheral.state === "connecting") peripheral.cancelConnect();
    if (peripheral.state === "connected") {
      await abortable(peripheral.disconnectAsync(), AbortSignal.timeout(2_000)).catch(() => {});
    }
  };
  peripheral.once("disconnect", onDisconnect);
  try {
    signal.throwIfAborted();
    await abortable(peripheral.connectAsync(), signal);
    const { characteristics } = await abortable(
      peripheral.discoverSomeServicesAndCharacteristicsAsync(["ff00"], ["ff01", "ff02"]),
      signal,
    );
    // Noble dispatches events to the last characteristic registered for a UUID.
    const tx = characteristics.findLast(({ uuid }) => uuid === "ff01");
    const rx = characteristics.findLast(({ uuid }) => uuid === "ff02");
    if (!tx || !rx) throw new Error("Marstek GATT characteristics FF01 and FF02 were not found");
    const withoutResponse = !tx.properties.includes("write");
    if (withoutResponse && !tx.properties.includes("writeWithoutResponse")) {
      throw new Error("Marstek FF01 is not writable");
    }
    await abortable(rx.subscribeAsync(), signal);
    return {
      signal: disconnected.signal,
      onBytes(receive) {
        rx.on("data", receive);
        return () => { rx.off("data", receive); };
      },
      write(bytes, signal) {
        signal.throwIfAborted();
        return abortable(tx.writeAsync(bytes, withoutResponse), signal);
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

// Noble shares its scan and connection state across all station loops.
let pending: Promise<unknown> = Promise.resolve();
const knownPeripherals = new Map<string, Peripheral>();

export const connectMacos: ConnectStation = (station, signal) => {
  const attempt = pending.then(async () => {
    const known = knownPeripherals.get(station.id);
    const candidates = known ? [known] : await discover(signal);
    let lastError: unknown = new Error("No matching Marstek Venus E 3.0 found over CoreBluetooth");
    for (const peripheral of candidates) {
      signal.throwIfAborted();
      if (peripheral.state !== "disconnected") continue;
      let connection: BleConnection | undefined;
      try {
        connection = await openPeripheral(peripheral, signal);
        verifyDevice(await requestFrame(connection, DEVICE_INFO, signal), station);
        knownPeripherals.set(station.id, peripheral);
        return connection;
      } catch (error) {
        await connection?.close();
        lastError = error;
      }
    }
    knownPeripherals.delete(station.id);
    throw lastError;
  });
  pending = attempt.catch(() => {});
  return attempt;
};

export function stopMacos() {
  try {
    noble.stop();
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "Stop: BLEManager has already been cleaned up") throw error;
  }
}
