import { abortable } from "./abort.ts";
import { DEVICE_INFO, FrameDecoder, GET_WORK_MODE_SETTINGS, readCommand, STATE, type ReadCommand } from "./protocol.ts";
import type { CollectorStation } from "../stations/types.ts";

interface ByteConnection {
  signal: AbortSignal;
  onBytes(receive: (bytes: Buffer) => void): () => void;
  write(bytes: Buffer, signal: AbortSignal): Promise<void>;
}

export interface BleConnection extends ByteConnection {
  close(): Promise<void>;
}

export type ConnectStation = (station: CollectorStation, signal: AbortSignal) => Promise<BleConnection>;

const commands = {
  [STATE]: { name: "STATE", timeoutMs: 4_000 },
  [DEVICE_INFO]: { name: "DEVICE_INFO", timeoutMs: 4_000 },
  [GET_WORK_MODE_SETTINGS]: { name: "GET_WORK_MODE_SETTINGS", timeoutMs: 2_000 },
};

export async function requestFrame(
  connection: ByteConnection,
  command: ReadCommand,
  parentSignal: AbortSignal,
): Promise<Buffer> {
  const { name, timeoutMs } = commands[command];
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = AbortSignal.any([parentSignal, connection.signal, timeout]);
  signal.throwIfAborted();
  const decoder = new FrameDecoder();
  const response = Promise.withResolvers<Buffer>();
  let bytesReceived = 0;
  let writeCompleted = false;
  const unsubscribe = connection.onBytes((bytes) => {
    bytesReceived += bytes.length;
    const frame = decoder.push(bytes).find((frame) => frame.command === command);
    if (frame) response.resolve(frame.payload);
  });
  try {
    const [payload] = await abortable(Promise.all([
      response.promise,
      connection.write(readCommand(command), signal).then(() => { writeCompleted = true; }),
    ]), signal);
    return payload;
  } catch (error) {
    if (timeout.aborted && error === timeout.reason) {
      throw new DOMException(
        `BLE request ${name} timed out after ${timeoutMs} ms (writeCompleted=${writeCompleted}, bytesReceived=${bytesReceived})`,
        "TimeoutError",
      );
    }
    throw error;
  } finally {
    unsubscribe();
  }
}
