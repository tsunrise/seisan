import type { SqlMigration } from "../migrations";

export const projectStoreMigrations: SqlMigration[] = [
  [
    `CREATE TABLE IF NOT EXISTS project_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        name TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        acl_type TEXT NOT NULL CHECK (acl_type IN ('public', 'restricted')),
        next_record_id INTEGER NOT NULL,
        next_member_id INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    `CREATE TABLE IF NOT EXISTS acl_allowed_list (
        email TEXT PRIMARY KEY
      )`,
    `CREATE TABLE IF NOT EXISTS members (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        linked_email TEXT UNIQUE,
        deleted_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS members_active_normalized_name_idx
        ON members(normalized_name)
        WHERE deleted_at IS NULL`,
    `CREATE TABLE IF NOT EXISTS records (
        id INTEGER PRIMARY KEY,
        author_member_id INTEGER NOT NULL,
        description_type TEXT NOT NULL,
        description_json TEXT NOT NULL,
        delta_json TEXT NOT NULL,
        reverts_record_id INTEGER UNIQUE,
        created_at INTEGER NOT NULL
      )`,
    `CREATE TABLE IF NOT EXISTS balances (
        member_id INTEGER PRIMARY KEY,
        amount_cents INTEGER NOT NULL
      )`,
  ],
  [`ALTER TABLE project_meta ADD COLUMN public_id TEXT`],
  [`DROP TABLE IF EXISTS acl_allowed_list`, `DROP TABLE IF EXISTS project_meta`],
  [`ALTER TABLE members ADD COLUMN config TEXT NOT NULL DEFAULT '{}'`],
  // SQLite cannot drop reverts_record_id in place because its inline UNIQUE constraint owns an
  // auto-index that cannot be dropped separately, so rebuild the table while preserving its rows.
  [
    `CREATE TABLE records_without_reverts (
        id INTEGER PRIMARY KEY,
        author_member_id INTEGER NOT NULL,
        description_type TEXT NOT NULL,
        description_json TEXT NOT NULL,
        delta_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER,
        updated_by_member_id INTEGER
      )`,
    `INSERT INTO records_without_reverts
        (id, author_member_id, description_type, description_json, delta_json, created_at)
      SELECT id, author_member_id, description_type, description_json, delta_json, created_at
      FROM records`,
    `DROP TABLE records`,
    `ALTER TABLE records_without_reverts RENAME TO records`,
  ],
];
