export type TelegramDestination = { token: string; chatId: string };

export class TelegramSendError extends Error {
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs = 0) {
    super(message);
    this.retryAfterMs = retryAfterMs;
  }
}

export async function sendTelegramMessage(
  { token, chatId }: TelegramDestination, message: string, shutdown: AbortSignal, request = fetch,
) {
  const signal = AbortSignal.any([shutdown, AbortSignal.timeout(10_000)]);
  try {
    const response = await request(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message }),
      redirect: "error",
      signal,
    });
    const result = await response.json().catch(() => null);
    if (response.ok && result?.ok === true) return;
    const retryAfter = result?.parameters?.retry_after;
    const retryAfterMs = Number.isSafeInteger(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1_000, 2_147_483_647) : 0;
    throw new TelegramSendError(`Telegram rejected the message (HTTP ${response.status})`, retryAfterMs);
  } catch (error) {
    shutdown.throwIfAborted();
    if (error instanceof TelegramSendError) throw error;
    throw new TelegramSendError("Telegram request failed");
  }
}
