CREATE TABLE responses (
 id TEXT PRIMARY KEY,
 edit_hash TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL,
 dates TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX attempts_expiry ON attempts(expires_at);
