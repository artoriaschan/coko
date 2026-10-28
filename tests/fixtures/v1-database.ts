// 版本 1 的 coko.db（M1 发布的库形状）：迁移测试的输入。DDL 按版本 1 冻结在这里，不从当前迁移列表导入，
// 以免以后修改迁移代码时输入随之变化。
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const V1_DDL = `
  CREATE TABLE workspaces (id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at INTEGER NOT NULL) STRICT;
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), title TEXT NOT NULL,
    model_provider_id TEXT, model_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    CHECK ((model_provider_id IS NULL) = (model_id IS NULL))
  ) STRICT;
  CREATE INDEX sessions_by_workspace ON sessions(workspace_id, updated_at);
  CREATE INDEX sessions_by_updated ON sessions(updated_at);
  CREATE TABLE session_entries (
    session_id TEXT NOT NULL REFERENCES sessions(id), seq INTEGER NOT NULL CHECK (seq >= 1), kind TEXT NOT NULL,
    payload_version INTEGER NOT NULL, payload TEXT NOT NULL, run_id TEXT, created_at INTEGER NOT NULL,
    PRIMARY KEY (session_id, seq)
  ) STRICT;
  CREATE TRIGGER session_entries_no_update BEFORE UPDATE ON session_entries
    BEGIN SELECT RAISE(ABORT, 'session entries are append-only'); END;
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, revision INTEGER NOT NULL CHECK (revision >= 1), updated_at INTEGER NOT NULL) STRICT;
  CREATE TABLE providers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, api TEXT NOT NULL, base_url TEXT NOT NULL,
    models TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE provider_credentials (
    provider_id TEXT PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE, ciphertext BLOB NOT NULL, hint TEXT NOT NULL, updated_at INTEGER NOT NULL
  ) STRICT;
`

export interface V1Entry {
  kind: string
  payload: unknown
  runId?: string
}

/** 在 path 写一个版本 1 的库：一个 Workspace、一个 Session 与给定条目（按顺序编号）。 */
export async function writeV1Database(path: string, input: { workspacePath: string; sessionId: string; title: string; entries: V1Entry[] }): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(path)
  try {
    db.exec(V1_DDL)
    db.prepare('INSERT INTO workspaces VALUES (?, ?, ?, 1)').run('w-v1', input.workspacePath, 'v1')
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?, NULL, NULL, 1, 1)').run(input.sessionId, 'w-v1', input.title)
    const insert = db.prepare('INSERT INTO session_entries VALUES (?, ?, ?, 1, ?, ?, 1)')
    input.entries.forEach((entry, i) => insert.run(input.sessionId, i + 1, entry.kind, JSON.stringify(entry.payload), entry.runId ?? null))
    db.exec('PRAGMA user_version = 1')
  } finally {
    db.close()
  }
}
