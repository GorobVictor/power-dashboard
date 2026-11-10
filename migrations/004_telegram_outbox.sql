-- Up Migration
CREATE TABLE telegram_outbox (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    message text NOT NULL
);

-- Down Migration
DROP TABLE telegram_outbox;
