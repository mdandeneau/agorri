-- Talk: every resident post (idea, question, debate argument, comment, reply, neighbor post) in one table.
-- Apply once to the D1 database bound to the Pages project as DB:  wrangler d1 execute agorri --remote --file=migrations/0001_talk.sql
CREATE TABLE IF NOT EXISTS talk_items (
  key TEXT PRIMARY KEY,            -- <author>~<item id>
  town TEXT NOT NULL,
  author TEXT NOT NULL,            -- salted hash of the browser's random id, never the raw id
  ip TEXT,                         -- salted hash of the connecting IP, for rate limits only
  kind TEXT NOT NULL,              -- idea | question | argument | comment | neighbor
  ref_t TEXT, ref_id TEXT, ref_label TEXT, ref_url TEXT,
  parent TEXT, stance TEXT, title TEXT, body TEXT, tag TEXT,
  name TEXT, anon INTEGER NOT NULL DEFAULT 0, verified INTEGER NOT NULL DEFAULT 0,
  at TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0, -- 1 = hidden by a moderator
  kept INTEGER NOT NULL DEFAULT 0    -- 1 = a moderator restored it after reports
);
CREATE INDEX IF NOT EXISTS talk_town_at ON talk_items (town, at);
CREATE INDEX IF NOT EXISTS talk_author_at ON talk_items (author, at);
CREATE TABLE IF NOT EXISTS talk_marks (
  key TEXT NOT NULL,
  author TEXT NOT NULL,
  mark TEXT NOT NULL,              -- support | report
  verified INTEGER NOT NULL DEFAULT 0,
  at TEXT NOT NULL,
  PRIMARY KEY (key, author, mark)
);
