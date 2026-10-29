ALTER TABLE responses ADD COLUMN deleted_at INTEGER;
CREATE INDEX responses_deleted_at ON responses(deleted_at);
