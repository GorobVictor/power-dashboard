import { addAbortListener } from "node:events";

export async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let subscription: ReturnType<typeof addAbortListener> | undefined;
  const aborted = new Promise<never>((_, reject) => {
    subscription = addAbortListener(signal, () => reject(signal.reason));
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    subscription?.[Symbol.dispose]();
  }
}
