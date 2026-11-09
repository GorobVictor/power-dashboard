import { abortable } from "./abort.ts";
import { DEVICE_INFO, FrameDecoder, readCommand, STATE } from "./protocol.ts";
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

export async function requestFrame(
  connection: ByteConnection,
  command: typeof STATE | typeof DEVICE_INFO,
  parentSignal: AbortSignal,
): Promise<Buffer> {
  const signal = AbortSignal.any([parentSignal, connection.signal, AbortSignal.timeout(4_000)]);
  signal.throwIfAborted();
  const decoder = new FrameDecoder();
  const response = Promise.withResolvers<Buffer>();
  const unsubscribe = connection.onBytes((bytes) => {
    const frame = decoder.push(bytes).find((frame) => frame.command === command);
    if (frame) response.resolve(frame.payload);
  });
  try {
    const [payload] = await abortable(Promise.all([
      response.promise,
      connection.write(readCommand(command), signal),
    ]), signal);
    return payload;
  } finally {
    unsubscribe();
  }
}
