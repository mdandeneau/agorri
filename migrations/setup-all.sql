CREATE TABLE IF NOT EXISTS talk_items (
  key TEXT PRIMARY KEY,
  town TEXT NOT NULL,
  author TEXT NOT NULL,
  ip TEXT,
  kind TEXT NOT NULL,
  ref_t TEXT, ref_id TEXT, ref_label TEXT, ref_url TEXT,
  parent TEXT, stance TEXT, title TEXT, body TEXT, tag TEXT,
  name TEXT, anon INTEGER NOT NULL DEFAULT 0, verified INTEGER NOT NULL DEFAULT 0,
  at TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  kept INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS talk_town_at ON talk_items (town, at);
CREATE INDEX IF NOT EXISTS talk_author_at ON talk_items (author, at);
CREATE TABLE IF NOT EXISTS talk_marks (
  key TEXT NOT NULL,
  author TEXT NOT NULL,
  mark TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  at TEXT NOT NULL,
  PRIMARY KEY (key, author, mark)
);
ALTER TABLE talk_items ADD COLUMN mod_status TEXT NOT NULL DEFAULT 'ok';
ALTER TABLE talk_items ADD COLUMN mod_cat TEXT;
ALTER TABLE talk_items ADD COLUMN mod_reason TEXT;
ALTER TABLE talk_items ADD COLUMN mod_by TEXT;
ALTER TABLE talk_items ADD COLUMN mod_at TEXT;
ALTER TABLE talk_items ADD COLUMN queued INTEGER NOT NULL DEFAULT 0;
ALTER TABLE talk_items ADD COLUMN appeal INTEGER NOT NULL DEFAULT 0;
ALTER TABLE talk_marks ADD COLUMN reason TEXT;
CREATE TABLE IF NOT EXISTS talk_modlog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT, town TEXT, at TEXT NOT NULL,
  by TEXT NOT NULL,
  trigger TEXT,
  decision TEXT, cat TEXT, reason TEXT
);
CREATE INDEX IF NOT EXISTS talk_modlog_town_at ON talk_modlog (town, at);
CREATE TABLE IF NOT EXISTS talk_residents (
  author TEXT NOT NULL,
  town TEXT NOT NULL,
  addr TEXT NOT NULL,
  username TEXT NOT NULL,
  method TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (author, town)
);
CREATE INDEX IF NOT EXISTS talk_residents_addr ON talk_residents (town, addr);
CREATE UNIQUE INDEX IF NOT EXISTS talk_residents_name ON talk_residents (town, username);
CREATE TABLE IF NOT EXISTS talk_config (k TEXT PRIMARY KEY, v TEXT NOT NULL);
