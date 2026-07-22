// Additive-only, ordered, idempotent schema migrations.
// Each migration runs at most once, tracked in schema_version. A copied
// Phase 1.5 database upgrades in place; a fresh database ends up at the same
// final schema; re-running is always a no-op. Pure functions operating on a
// caller-supplied `db` (a node:sqlite DatabaseSync instance) — no module-level
// side effects, so tests can run these against any database.

export function createBaseTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS portfolio (
      id           TEXT PRIMARY KEY,
      symbol       TEXT NOT NULL,
      name         TEXT DEFAULT '',
      type         TEXT DEFAULT 'stock',
      quantity     REAL DEFAULT 0,
      avgPrice     REAL DEFAULT 0,
      exchange     TEXT DEFAULT '',
      watchlistOnly INTEGER DEFAULT 0,
      added_at     TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id     TEXT PRIMARY KEY,
      title  TEXT NOT NULL,
      time   TEXT NOT NULL,
      days   TEXT DEFAULT 'daily',
      active INTEGER DEFAULT 1,
      note   TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS events (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      date        TEXT NOT NULL,
      time        TEXT,
      description TEXT DEFAULT '',
      type        TEXT DEFAULT 'event'
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id       TEXT PRIMARY KEY,
      title    TEXT NOT NULL,
      due      TEXT,
      priority TEXT DEFAULT 'medium',
      source   TEXT DEFAULT 'manual',
      done     INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS history (
      id        TEXT PRIMARY KEY,
      type      TEXT NOT NULL,
      summary   TEXT DEFAULT '',
      timestamp TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS display_cache (
      id          INTEGER PRIMARY KEY DEFAULT 1,
      html        TEXT DEFAULT '',
      contentType TEXT DEFAULT '',
      decision    TEXT DEFAULT '',
      timestamp   TEXT DEFAULT '',
      generating  INTEGER DEFAULT 0
    );
  `);
}

function addColumnIfMissing(db, table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

const MIGRATIONS = [
  {
    version: 1,
    up(db) {
      // tasks already carries `source` since Phase 1.5 — only sourceEmailId is new
      addColumnIfMissing(db, 'tasks', 'sourceEmailId', 'TEXT');
      addColumnIfMissing(db, 'events', 'source', "TEXT DEFAULT 'manual'");
      addColumnIfMissing(db, 'events', 'sourceRef', 'TEXT');
      addColumnIfMissing(db, 'portfolio', 'source', "TEXT DEFAULT 'manual'");
      addColumnIfMissing(db, 'portfolio', 'sourceEmailId', 'TEXT');
      addColumnIfMissing(db, 'history', 'layoutFingerprint', 'TEXT');
    },
  },
  {
    version: 2,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS bills (
          id            TEXT PRIMARY KEY,
          vendor        TEXT NOT NULL,
          amount        REAL DEFAULT 0,
          currency      TEXT DEFAULT 'INR',
          dueDate       TEXT,
          status        TEXT DEFAULT 'due',
          sourceEmailId TEXT
        );

        CREATE TABLE IF NOT EXISTS mail_accounts (
          id           TEXT PRIMARY KEY,
          emailAddress TEXT NOT NULL,
          label        TEXT DEFAULT '',
          status       TEXT DEFAULT 'connected',
          connectedAt  TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS allowlist_entries (
          id        TEXT PRIMARY KEY,
          accountId TEXT NOT NULL REFERENCES mail_accounts(id),
          pattern   TEXT NOT NULL,
          kind      TEXT DEFAULT 'sender',
          type      TEXT DEFAULT 'transactional'
        );

        CREATE TABLE IF NOT EXISTS oauth_tokens (
          id              TEXT PRIMARY KEY,
          accountId       TEXT NOT NULL REFERENCES mail_accounts(id),
          service         TEXT NOT NULL,
          refreshTokenEnc TEXT NOT NULL,
          scope           TEXT DEFAULT '',
          updatedAt       TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS processed_emails (
          gmailMessageId TEXT PRIMARY KEY,
          accountId      TEXT NOT NULL REFERENCES mail_accounts(id),
          sender         TEXT DEFAULT '',
          subject        TEXT DEFAULT '',
          processedAt    TEXT DEFAULT (datetime('now')),
          outcome        TEXT DEFAULT 'extracted',
          reason         TEXT,
          factRefs       TEXT DEFAULT '[]'
        );

        CREATE TABLE IF NOT EXISTS digest_items (
          id            TEXT PRIMARY KEY,
          headline      TEXT NOT NULL,
          sourceSender  TEXT DEFAULT '',
          accountId     TEXT REFERENCES mail_accounts(id),
          sourceEmailId TEXT REFERENCES processed_emails(gmailMessageId),
          receivedAt    TEXT DEFAULT (datetime('now')),
          expiresAt     TEXT
        );

        CREATE TABLE IF NOT EXISTS identity_vault (
          key       TEXT PRIMARY KEY,
          valueEnc  TEXT NOT NULL,
          updatedAt TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS document_passwords (
          id            TEXT PRIMARY KEY,
          senderPattern TEXT NOT NULL,
          passwordEnc   TEXT NOT NULL,
          lastUsedAt    TEXT,
          createdAt     TEXT DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    version: 3,
    up(db) {
      // Google OAuth token-refresh bookkeeping (ENGINEERING §3.1): 3 consecutive
      // refresh failures flips mail_accounts.status to 'error'.
      addColumnIfMissing(db, 'mail_accounts', 'authFailCount', 'INTEGER DEFAULT 0');
      addColumnIfMissing(db, 'mail_accounts', 'lastError', 'TEXT');
    },
  },
];

export function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version   INTEGER PRIMARY KEY,
      appliedAt TEXT DEFAULT (datetime('now'))
    );
  `);
  const { v: current } = db.prepare('SELECT MAX(version) AS v FROM schema_version').get();
  for (const migration of MIGRATIONS) {
    if (current !== null && migration.version <= current) continue;
    db.exec('BEGIN');
    try {
      migration.up(db);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(migration.version);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
