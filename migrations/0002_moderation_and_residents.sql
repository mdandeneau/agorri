-- Moderation (AI review on every post and every flag, a person for grey areas) and address-checked residents.
-- Apply after 0001:  wrangler d1 execute agorri --remote --file=migrations/0002_moderation_and_residents.sql
ALTER TABLE talk_items ADD COLUMN mod_status TEXT NOT NULL DEFAULT 'ok';  -- ok | pending (held for a person) | restricted (not shown)
ALTER TABLE talk_items ADD COLUMN mod_cat TEXT;
ALTER TABLE talk_items ADD COLUMN mod_reason TEXT;
ALTER TABLE talk_items ADD COLUMN mod_by TEXT;                           -- ai | rules | person
ALTER TABLE talk_items ADD COLUMN mod_at TEXT;
ALTER TABLE talk_items ADD COLUMN queued INTEGER NOT NULL DEFAULT 0;      -- 1 = visible, but a person should look (flagged grey area)
ALTER TABLE talk_items ADD COLUMN appeal INTEGER NOT NULL DEFAULT 0;      -- 1 = the author asked a person to review a blocked post
ALTER TABLE talk_marks ADD COLUMN reason TEXT;                            -- why a resident flagged a post
CREATE TABLE IF NOT EXISTS talk_modlog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT, town TEXT, at TEXT NOT NULL,
  by TEXT NOT NULL,          -- ai | person | rules
  trigger TEXT,              -- post | flag | appeal | queue
  decision TEXT, cat TEXT, reason TEXT
);
CREATE INDEX IF NOT EXISTS talk_modlog_town_at ON talk_modlog (town, at);
CREATE TABLE IF NOT EXISTS talk_residents (
  author TEXT NOT NULL,      -- salted hash of the browser id
  town TEXT NOT NULL,
  addr TEXT NOT NULL,        -- salted hash of the matched address, never the address itself
  username TEXT NOT NULL,
  method TEXT NOT NULL,      -- address (Census match); later: mail, id
  at TEXT NOT NULL,
  PRIMARY KEY (author, town)
);
CREATE INDEX IF NOT EXISTS talk_residents_addr ON talk_residents (town, addr);
CREATE UNIQUE INDEX IF NOT EXISTS talk_residents_name ON talk_residents (town, username);
