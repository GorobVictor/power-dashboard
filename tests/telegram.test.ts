import assert from "node:assert/strict";
import test from "node:test";
import { sendTelegramMessage, TelegramSendError } from "../src/server/telegram/client.ts";
import { escapeMarkdown } from "../src/server/telegram/markdown.ts";

const destination = { token: "123:test-token", chatId: "-1001234567890" };

test("sends MarkdownV2 when requested and preserves queued plain text", async () => {
  const signal = new AbortController().signal;
  for (const parseMode of ["MarkdownV2", null] as const) {
    const text = parseMode ? "⚡ *Акумулятор почав заряджатися*" : "Акумулятор почав заряджатися.";
    await sendTelegramMessage(destination, { text, parseMode }, signal, async (input, init) => {
      assert.equal(String(input), "https://api.telegram.org/bot123:test-token/sendMessage");
      assert.equal(init?.method, "POST");
      assert.equal(init?.redirect, "error");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        chat_id: destination.chatId,
        text,
        ...(parseMode ? { parse_mode: parseMode } : {}),
      });
      return Response.json({ ok: true });
    });
  }
});

test("escapes MarkdownV2 punctuation in dynamic message text", () => {
  const reserved = "\\_*[]()~`>#+-=|{}.!";
  assert.equal(escapeMarkdown(reserved), [...reserved].map((character) => "\\" + character).join(""));
  assert.equal(escapeMarkdown("Черга 3.2"), "Черга 3\\.2");
});

test("keeps retry hints and excludes the bot token from errors", async () => {
  const signal = new AbortController().signal;
  await assert.rejects(sendTelegramMessage(destination, { text: "test" }, signal, async () =>
    Response.json({ ok: false, parameters: { retry_after: 7 } }, { status: 429 })),
  (error) => error instanceof TelegramSendError && error.retryAfterMs === 7_000);

  await assert.rejects(sendTelegramMessage(destination, { text: "test" }, signal, async (input) => {
    throw new Error(`Failed to fetch ${input}`);
  }), { message: "Telegram request failed" });
});
