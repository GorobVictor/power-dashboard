import type { Client } from "pg";

export async function enqueueTelegramMessages(db: Client, messages: readonly string[]) {
  if (messages.length === 0) return;
  await db.query(
    "INSERT INTO telegram_outbox (message, parse_mode) SELECT unnest($1::text[]), 'MarkdownV2'",
    [messages],
  );
}
