-- Settings kept in the database (a random hashing salt when no TALK_SALT secret is set).
CREATE TABLE IF NOT EXISTS talk_config (k TEXT PRIMARY KEY, v TEXT NOT NULL);
