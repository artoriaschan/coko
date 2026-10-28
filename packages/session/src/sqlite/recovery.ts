// 启动恢复的跨 Session 查询（SQLite 专有，经 session_entries_by_kind 索引）。只读；结果的 payload 与 listEntries 一样迁移到当前版本。
import { upgradeEntries, type StoredEntry } from '../internal.ts'
import type { JsonValue, SessionEntry, StoreOptions } from '../types.ts'
import type { Connection } from './connection.ts'

/** 有 run_start 而没有其后同 runId 的 run_end 的 Run：进程在 Run 进行中退出（崩溃或被强杀）。 */
export interface UnfinishedRun {
  sessionId: string
  runId: string
  /** 该 Run 的 run_start 条目的 seq。 */
  startSeq: number
}

export interface RecoveryQueries {
  /** 按 sessionId、startSeq 升序。没有 runId 的 run_start 不计入。 */
  listUnfinishedRuns(): Promise<UnfinishedRun[]>
  /** 每个 Session 中该 kind 的最后一条条目（按 seq）；没有该 kind 的 Session 不出现。迁移后不合格的条目跳过并报告。 */
  listLatestEntries(kind: string): Promise<SessionEntry[]>
}

const later = <T>(fn: () => T): Promise<T> => new Promise((resolve) => resolve(fn()))

interface EntryRow {
  session_id: string
  seq: number
  kind: string
  payload_version: number
  payload: string
  run_id: string | null
  created_at: number
}

const parse = (text: string): JsonValue | undefined => {
  try {
    return JSON.parse(text) as JsonValue
  } catch {
    return undefined
  }
}

export function createRecoveryQueries(conn: Connection, payloads: Pick<StoreOptions, 'payloads' | 'onInvalidEntry'>): RecoveryQueries {
  return {
    listUnfinishedRuns: () =>
      later(() =>
        conn.read(() =>
          conn
            .all<{ session_id: string; run_id: string; seq: number }>(
              `SELECT s.session_id, s.run_id, s.seq FROM session_entries s
               WHERE s.kind = 'run_start' AND s.run_id IS NOT NULL AND NOT EXISTS (
                 SELECT 1 FROM session_entries e
                 WHERE e.session_id = s.session_id AND e.kind = 'run_end' AND e.run_id = s.run_id AND e.seq > s.seq)
               ORDER BY s.session_id, s.seq`,
            )
            .map((r) => ({ sessionId: r.session_id, runId: r.run_id, startSeq: r.seq })),
        ),
      ),
    listLatestEntries: (kind) =>
      later(() =>
        conn.read(() => {
          const rows = conn.all<EntryRow>(
            `SELECT e.session_id, e.seq, e.kind, e.payload_version, e.payload, e.run_id, e.created_at FROM session_entries e
             JOIN (SELECT session_id, MAX(seq) AS seq FROM session_entries WHERE kind = ? GROUP BY session_id) last
               ON last.session_id = e.session_id AND last.seq = e.seq
             ORDER BY e.session_id`,
            kind,
          )
          const stored = rows.map((r): StoredEntry => ({
            sessionId: r.session_id,
            seq: r.seq,
            kind: r.kind,
            payloadVersion: r.payload_version,
            payload: parse(r.payload),
            runId: r.run_id,
            createdAt: r.created_at,
          }))
          return upgradeEntries(stored, payloads)
        }),
      ),
  }
}
