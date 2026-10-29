// 编号前向迁移：第 N 项把库从 user_version N-1 迁到 N。已发布的迁移不得修改，只能追加。
import type { DatabaseSync } from 'node:sqlite'

export interface Migration {
  version: number
  up(db: DatabaseSync): void
}

/** 宿主租约表在迁移之前创建，任何版本的库都有，以便迁移本身在租约保护下进行。 */
export const HOST_LEASE_DDL = `
  CREATE TABLE IF NOT EXISTS host_lease (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    instance_id  TEXT NOT NULL,
    pid          INTEGER NOT NULL,
    acquired_at  INTEGER NOT NULL,
    heartbeat_at INTEGER NOT NULL
  ) STRICT
`

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    up(db) {
      db.exec(`
        CREATE TABLE workspaces (
          id         TEXT PRIMARY KEY,
          path       TEXT NOT NULL UNIQUE,
          name       TEXT NOT NULL,
          created_at INTEGER NOT NULL
        ) STRICT;

        CREATE TABLE sessions (
          id                TEXT PRIMARY KEY,
          workspace_id      TEXT NOT NULL REFERENCES workspaces(id),
          title             TEXT NOT NULL,
          model_provider_id TEXT,
          model_id          TEXT,
          created_at        INTEGER NOT NULL,
          updated_at        INTEGER NOT NULL,
          CHECK ((model_provider_id IS NULL) = (model_id IS NULL))
        ) STRICT;
        CREATE INDEX sessions_by_workspace ON sessions(workspace_id, updated_at);
        CREATE INDEX sessions_by_updated ON sessions(updated_at);

        CREATE TABLE session_entries (
          session_id      TEXT NOT NULL REFERENCES sessions(id),
          seq             INTEGER NOT NULL CHECK (seq >= 1),
          kind            TEXT NOT NULL,
          payload_version INTEGER NOT NULL,
          payload         TEXT NOT NULL,
          run_id          TEXT,
          created_at      INTEGER NOT NULL,
          PRIMARY KEY (session_id, seq)
        ) STRICT;
        -- Session Entry 不可修改。
        CREATE TRIGGER session_entries_no_update BEFORE UPDATE ON session_entries
          BEGIN SELECT RAISE(ABORT, 'session entries are append-only'); END;

        CREATE TABLE settings (
          key        TEXT PRIMARY KEY,
          value      TEXT NOT NULL,
          revision   INTEGER NOT NULL CHECK (revision >= 1),
          updated_at INTEGER NOT NULL
        ) STRICT;

        CREATE TABLE providers (
          id         TEXT PRIMARY KEY,
          name       TEXT NOT NULL,
          kind       TEXT NOT NULL,
          api        TEXT NOT NULL,
          base_url   TEXT NOT NULL,
          models     TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        ) STRICT;

        -- 只存 main 用 safeStorage 加密后的密文（ADR 0004）。
        CREATE TABLE provider_credentials (
          provider_id TEXT PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
          ciphertext  BLOB NOT NULL,
          hint        TEXT NOT NULL,
          updated_at  INTEGER NOT NULL
        ) STRICT;
      `)
    },
  },
  {
    // 启动恢复：按 kind 查找 Session 内的 run_start / run_end 等条目（ADR 0003 的迁移证据）。
    version: 2,
    up(db) {
      db.exec('CREATE INDEX session_entries_by_kind ON session_entries(session_id, kind, seq)')
    },
  },
  {
    // M3：Memory（ADR 0003）与登记的 Secret（ADR 0007）。
    version: 3,
    up(db) {
      db.exec(`
        CREATE TABLE memories (
          id           TEXT PRIMARY KEY,
          scope        TEXT NOT NULL CHECK (scope IN ('user', 'workspace')),
          workspace_id TEXT REFERENCES workspaces(id),
          content      TEXT NOT NULL,
          source       TEXT NOT NULL,
          created_at   INTEGER NOT NULL,
          updated_at   INTEGER NOT NULL,
          CHECK ((scope = 'workspace') = (workspace_id IS NOT NULL))
        ) STRICT;
        CREATE INDEX memories_by_scope ON memories(scope, workspace_id, updated_at);

        -- 只存 main 用 safeStorage 加密后的密文（ADR 0007）。
        CREATE TABLE secrets (
          name       TEXT PRIMARY KEY,
          ciphertext BLOB NOT NULL,
          hint       TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        ) STRICT;
      `)
    },
  },
]
