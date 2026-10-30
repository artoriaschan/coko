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
  {
    // 模型服务（ADR 0010）：去掉 Provider kind，ID 由用户输入，Model Catalog 显式保存各模型能力。不兼容旧数据：
    // 删除已有 Provider 与 Credential（迁移前的备份保留它们）、清空默认模型设置与 Session 的模型字段（不改 updated_at）。
    // 发布前的修订（v4 只在未发布的 model-service 分支上）：清空前把这些 Session 的 ID 记在 model_cleared_sessions 中，v6 据此
    // 标为“模型被清空”后删除该表（sessions 的 CHECK 要求两个模型字段同时为空，墓碑不能留在行内）。
    version: 4,
    up(db) {
      db.exec(`
        DROP TABLE provider_credentials;
        DROP TABLE providers;

        CREATE TABLE providers (
          id         TEXT PRIMARY KEY,
          name       TEXT NOT NULL,
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

        DELETE FROM settings WHERE key = 'defaultModel';
        CREATE TABLE model_cleared_sessions (id TEXT PRIMARY KEY) STRICT;
        INSERT INTO model_cleared_sessions SELECT id FROM sessions WHERE model_provider_id IS NOT NULL;
        UPDATE sessions SET model_provider_id = NULL, model_id = NULL WHERE model_provider_id IS NOT NULL;
      `)
    },
  },
  {
    // 模型服务：Session 的 Thinking Level 与模型一起保存；已有 Session 为 off（按协议的默认关闭方式请求）。
    version: 5,
    up(db) {
      db.exec("ALTER TABLE sessions ADD COLUMN thinking_level TEXT NOT NULL DEFAULT 'off'")
    },
  },
  {
    // 模型服务：区分模型字段“被清空”（Provider 被删除、v4 升级清除；下次运行前要求重新选择）与“从未设置”（运行时取默认模型）。
    // 被清空的是 v4 记在 model_cleared_sessions 中的 Session，以及按旧版 v4（没有该表）迁过的开发库中模型为空且运行过（没有模型
    // 不能开始 Run）的 Session。标记后删除该表。不改 updated_at。
    version: 6,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS model_cleared_sessions (id TEXT PRIMARY KEY) STRICT;
        ALTER TABLE sessions ADD COLUMN model_cleared INTEGER NOT NULL DEFAULT 0;
        UPDATE sessions SET model_cleared = 1
          WHERE model_provider_id IS NULL
            AND (id IN (SELECT id FROM model_cleared_sessions)
                 OR EXISTS (SELECT 1 FROM session_entries e WHERE e.session_id = sessions.id AND e.kind IN ('message', 'run_start', 'run_end')));
        DROP TABLE model_cleared_sessions;
      `)
    },
  },
  {
    // M4：宿主启动的子进程登记（ADR 0012）。started_at 为 `ps -o lstart=` 原文，启动时核对同一 pid 是否仍是同一个进程。
    // session_id / job_id 不设外键：登记行只在进程存活期间存在，MCP 进程不属于任何 Session。
    version: 7,
    up(db) {
      db.exec(`
        CREATE TABLE host_processes (
          id         TEXT PRIMARY KEY,
          pid        INTEGER NOT NULL CHECK (pid > 0),
          pgid       INTEGER CHECK (pgid IS NULL OR pgid > 0),
          started_at TEXT NOT NULL,
          kind       TEXT NOT NULL CHECK (kind IN ('bash', 'job', 'pty', 'mcp')),
          session_id TEXT,
          job_id     TEXT,
          command    TEXT NOT NULL,
          created_at INTEGER NOT NULL
        ) STRICT;
      `)
    },
  },
  {
    // M5：子 Session 与 worktree 绑定（ADR 0014、0016）、定时任务（ADR 0015）、子进程登记增加 hook 与 git 类别（ADR 0012）。
    // host_processes 的 kind CHECK 不能原地修改：按原样复制登记行后重建。worktrees 先于 sessions.worktree_id 创建（外键引用）。
    version: 8,
    up(db) {
      db.exec(`
        CREATE TABLE worktrees (
          id           TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id),
          name         TEXT NOT NULL,
          path         TEXT NOT NULL UNIQUE,
          branch       TEXT NOT NULL,
          base_commit  TEXT NOT NULL,
          repo_root    TEXT NOT NULL,
          status       TEXT NOT NULL CHECK (status IN ('active', 'removed')),
          created_by   TEXT NOT NULL CHECK (created_by IN ('user', 'subagent')),
          created_at   INTEGER NOT NULL,
          removed_at   INTEGER,
          CHECK ((status = 'removed') = (removed_at IS NOT NULL))
        ) STRICT;
        CREATE INDEX worktrees_by_workspace ON worktrees(workspace_id, created_at);

        ALTER TABLE sessions ADD COLUMN parent_session_id TEXT REFERENCES sessions(id);
        ALTER TABLE sessions ADD COLUMN worktree_id TEXT REFERENCES worktrees(id);
        CREATE INDEX sessions_by_parent ON sessions(parent_session_id, created_at);

        CREATE TABLE schedules (
          id              TEXT PRIMARY KEY,
          session_id      TEXT NOT NULL REFERENCES sessions(id),
          title           TEXT NOT NULL,
          prompt          TEXT NOT NULL,
          rule            TEXT NOT NULL,
          status          TEXT NOT NULL CHECK (status IN ('active', 'paused', 'inactive')),
          next_at         INTEGER,
          last_occurrence INTEGER,
          revision        INTEGER NOT NULL CHECK (revision >= 1),
          created_at      INTEGER NOT NULL,
          updated_at      INTEGER NOT NULL
        ) STRICT;
        CREATE INDEX schedules_by_next ON schedules(next_at);
        CREATE INDEX schedules_by_session ON schedules(session_id, created_at);

        CREATE TABLE host_processes_v8 (
          id         TEXT PRIMARY KEY,
          pid        INTEGER NOT NULL CHECK (pid > 0),
          pgid       INTEGER CHECK (pgid IS NULL OR pgid > 0),
          started_at TEXT NOT NULL,
          kind       TEXT NOT NULL CHECK (kind IN ('bash', 'job', 'pty', 'mcp', 'hook', 'git')),
          session_id TEXT,
          job_id     TEXT,
          command    TEXT NOT NULL,
          created_at INTEGER NOT NULL
        ) STRICT;
        INSERT INTO host_processes_v8 (rowid, id, pid, pgid, started_at, kind, session_id, job_id, command, created_at)
          SELECT rowid, id, pid, pgid, started_at, kind, session_id, job_id, command, created_at FROM host_processes;
        DROP TABLE host_processes;
        ALTER TABLE host_processes_v8 RENAME TO host_processes;
      `)
    },
  },
]
