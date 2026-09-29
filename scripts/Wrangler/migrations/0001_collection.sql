CREATE TABLE IF NOT EXISTS collection_documents (
  user_id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  iv TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS collection_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0 CHECK (consumed IN (0, 1))
);

CREATE INDEX IF NOT EXISTS collection_challenges_user_expiry
  ON collection_challenges (user_id, expires_at, consumed);
