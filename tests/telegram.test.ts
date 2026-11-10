import assert from "node:assert/strict";
import test from "node:test";
import { sendTelegramMessage, TelegramSendError } from "../src/server/telegram/client.ts";

const destination = { token: "123:test-token", chatId: "-1001234567890" };

test("sends a plain text message to the configured channel", async () => {
  const signal = new AbortController().signal;
  await sendTelegramMessage(destination, "Акумулятор почав заряджатися.", signal, async (input, init) => {
    assert.equal(String(input), "https://api.telegram.org/bot123:test-token/sendMessage");
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      chat_id: destination.chatId,
      text: "Акумулятор почав заряджатися.",
    });
    return Response.json({ ok: true });
  });
});

test("keeps retry hints and excludes the bot token from errors", async () => {
  const signal = new AbortController().signal;
  await assert.rejects(sendTelegramMessage(destination, "test", signal, async () =>
    Response.json({ ok: false, parameters: { retry_after: 7 } }, { status: 429 })),
  (error) => error instanceof TelegramSendError && error.retryAfterMs === 7_000);

  await assert.rejects(sendTelegramMessage(destination, "test", signal, async (input) => {
    throw new Error(`Failed to fetch ${input}`);
  }), { message: "Telegram request failed" });
});
