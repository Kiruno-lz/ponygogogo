CREATE TABLE IF NOT EXISTS collection_rate_limits (
  ip_hash TEXT PRIMARY KEY,
  window_minute INTEGER NOT NULL,
  count INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS collection_challenges_expiry
  ON collection_challenges (expires_at);

CREATE INDEX IF NOT EXISTS collection_rate_limits_window
  ON collection_rate_limits (window_minute);
