// 宿主登记的子进程的 SQLite 仓库（迁移 v7；ADR 0012）。
import { alreadyExists, checkHostProcess } from '../internal.ts'
import type { HostProcess, HostProcessKind, ProcessRepository } from '../types.ts'
import type { Connection } from './connection.ts'

const later = <T>(fn: () => T): Promise<T> => new Promise((resolve) => resolve(fn()))

interface ProcessRow {
  id: string
  pid: number
  pgid: number | null
  started_at: string
  kind: HostProcessKind
  session_id: string | null
  job_id: string | null
  command: string
  created_at: number
}

const toProcess = (r: ProcessRow): HostProcess => ({
  id: r.id,
  pid: r.pid,
  pgid: r.pgid,
  startedAt: r.started_at,
  kind: r.kind,
  sessionId: r.session_id,
  jobId: r.job_id,
  command: r.command,
  createdAt: r.created_at,
})

export function createProcessRepository(conn: Connection): ProcessRepository {
  const select = (id: string) => conn.get<ProcessRow>('SELECT * FROM host_processes WHERE id = ?', id)
  return {
    register: (input) =>
      later(() =>
        conn.write(() => {
          const { pgid, sessionId, jobId } = checkHostProcess(input)
          if (select(input.id)) throw alreadyExists('process', input.id)
          conn.run(
            'INSERT INTO host_processes (id, pid, pgid, started_at, kind, session_id, job_id, command, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            input.id,
            input.pid,
            pgid,
            input.startedAt,
            input.kind,
            sessionId,
            jobId,
            input.command,
            conn.now(),
          )
          return toProcess(select(input.id)!)
        }),
      ),
    remove: (id) =>
      later(() =>
        conn.write(() => {
          conn.run('DELETE FROM host_processes WHERE id = ?', id)
        }),
      ),
    list: () => later(() => conn.read(() => conn.all<ProcessRow>('SELECT * FROM host_processes ORDER BY created_at, rowid').map(toProcess))),
  }
}
