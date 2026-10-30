-- Today's question answers (also created automatically by /api/question)
CREATE TABLE IF NOT EXISTS q_answers (qid TEXT NOT NULL, town TEXT NOT NULL, author TEXT NOT NULL, choice TEXT NOT NULL, verified INTEGER DEFAULT 0, at TEXT NOT NULL, PRIMARY KEY (qid, author));
