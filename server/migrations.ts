// Schema changes, applied in order; the database remembers the last id in user_version.

export interface Migration {
  id: number;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    sql: `
CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE TABLE sessions (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   BLOB NOT NULL UNIQUE,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  user_agent   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE settings (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  doc        TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE bests (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  circuit_id TEXT NOT NULL,
  segment_id TEXT NOT NULL DEFAULT '',
  lap_time   REAL NOT NULL,
  trace      TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, circuit_id, segment_id)
) WITHOUT ROWID;
CREATE TABLE workouts (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  name       TEXT NOT NULL,
  text       TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
) WITHOUT ROWID;
CREATE TABLE rides (
  id           TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at   INTEGER NOT NULL,
  circuit_id   TEXT NOT NULL,
  circuit_name TEXT NOT NULL,
  filename     TEXT NOT NULL,
  summary      TEXT NOT NULL,
  meta         TEXT NOT NULL DEFAULT '{}',
  fit          BLOB NOT NULL,
  fit_bytes    INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  UNIQUE (user_id, started_at)
);
CREATE INDEX rides_user_started ON rides(user_id, started_at DESC);
`,
  },
  {
    id: 2,
    sql: `
CREATE TABLE intervals (
  user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  api_key      BLOB NOT NULL,
  athlete_id   TEXT NOT NULL,
  athlete_name TEXT NOT NULL,
  auto         INTEGER NOT NULL DEFAULT 1,
  connected_at INTEGER NOT NULL
);
ALTER TABLE rides ADD COLUMN intervals_id TEXT;
ALTER TABLE rides ADD COLUMN intervals_at INTEGER;
ALTER TABLE rides ADD COLUMN intervals_error TEXT;
`,
  },
];
