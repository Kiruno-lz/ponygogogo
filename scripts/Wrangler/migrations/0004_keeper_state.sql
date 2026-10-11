CREATE TABLE keeper_state (
  game TEXT PRIMARY KEY,
  cursor TEXT NOT NULL,
  sessions TEXT NOT NULL,
  leased_until INTEGER NOT NULL DEFAULT 0
);
