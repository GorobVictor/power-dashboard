-- Up Migration
ALTER TABLE telegram_outbox
    ADD COLUMN parse_mode text CHECK (parse_mode = 'MarkdownV2');

-- Down Migration
ALTER TABLE telegram_outbox DROP COLUMN parse_mode;
