CREATE TABLE preferences (
 id TEXT PRIMARY KEY,
 edit_hash TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL,
 choices TEXT NOT NULL,
 updated_at INTEGER NOT NULL
);
