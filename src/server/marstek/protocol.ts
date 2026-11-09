import type { CollectorStation, Metrics } from "../stations/types.ts";

const MAGIC = 0x73;
const MARKER = 0x23;
const MAX_FRAME_BYTES = 4096;
export const STATE = 0x03;
export const DEVICE_INFO = 0x04;

function checksum(bytes: Uint8Array): number {
  return bytes.reduce((xor, byte) => xor ^ byte, 0);
}

export function readCommand(command: typeof STATE | typeof DEVICE_INFO): Buffer {
  const header = Buffer.from([MAGIC, 5, MARKER, command]);
  return Buffer.concat([header, Buffer.from([checksum(header)])]);
}

export interface Frame {
  command: number;
  payload: Buffer;
}

export class FrameDecoder {
  private pending = Buffer.alloc(0);

  push(chunk: Buffer): Frame[] {
    const frames: Frame[] = [];
    let bytes = Buffer.concat([this.pending, chunk]);
    while (bytes.length) {
      const start = bytes.indexOf(MAGIC);
      if (start === -1) {
        bytes = Buffer.alloc(0);
        break;
      }
      bytes = bytes.subarray(start);
      if (bytes.length < 4) break;

      const transition = bytes[3] === MARKER;
      const commandOffset = transition ? 4 : 3;
      const length = transition ? bytes.readUInt16BE(1) : bytes[1];
      if ((!transition && bytes[2] !== MARKER) ||
          length < commandOffset + 2 || length > MAX_FRAME_BYTES) {
        bytes = bytes.subarray(1);
        continue;
      }
      if (bytes.length < length) break;

      const frame = bytes.subarray(0, length);
      bytes = bytes.subarray(length);
      if (checksum(frame) === 0) {
        frames.push({ command: frame[commandOffset], payload: frame.subarray(commandOffset + 1, -1) });
      }
    }
    this.pending = bytes;
    return frames;
  }
}

export function verifyDevice(payload: Buffer, station: CollectorStation): void {
  const fields = new Map(
    payload.toString("utf8").replace(/\0+$/, "").split(",").map((field) => {
      const [key, value] = field.split("=", 2);
      return [key.trim(), value?.trim()];
    }),
  );
  if (fields.get("type") !== station.model || fields.get("id")?.toLowerCase() !== station.deviceId.toLowerCase()) {
    throw new Error("BLE device model or Device ID differs from the registered station");
  }
  if (fields.get("type") !== "VNSE3-0" || fields.get("dev_ver") !== "150") {
    throw new Error("Unsupported BLE profile. Expected VNSE3-0 with EMS 150");
  }
}

export function decodeState(payload: Buffer): Metrics {
  if (payload.length !== 139) {
    throw new Error(`Unexpected VNSE3-0 EMS 150 STATE payload length: ${payload.length}`);
  }
  const remainingEnergy = payload.readInt16LE(9);
  return {
    socPct: payload[11] <= 100 ? payload[11] : null,
    remainingEnergyWh: remainingEnergy >= 0 ? remainingEnergy * 10 : null,
    batteryPowerW: payload.readInt16LE(112),
    gridPowerW: payload.readInt16LE(116),
    acOutputPowerW: payload.readInt16LE(2),
    backupLoadPowerW: payload.readInt16LE(0),
    inverterState: payload[4],
    workMode: payload[38],
    dailyEnergyInWh: payload.readUInt32LE(14) * 10,
    dailyEnergyOutWh: payload.readUInt32LE(22) * 10,
    monthlyEnergyInWh: payload.readUInt32LE(18), // EMS 150 reports this counter in 1 Wh units.
    monthlyEnergyOutWh: payload.readUInt32LE(26) * 10,
    totalEnergyInWh: payload.readUInt32LE(41) * 10,
    totalEnergyOutWh: payload.readUInt32LE(45) * 10,
  };
}
