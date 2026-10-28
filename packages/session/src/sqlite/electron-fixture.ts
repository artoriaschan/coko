// 由 electron-runtime.test.ts 以 ELECTRON_RUN_AS_NODE=1 启动的子进程脚本，在 Electron 内置 Node 中运行 SQLite 入口。
// 用法：<electron> electron-fixture.ts <write|read|hold> <dbPath>；每行 stdout 是一个 JSON 对象。
import { isStoreError } from '../errors.ts'
import { TEST_PAYLOADS } from '../test-payloads.ts'
import { openSqliteStore } from './index.ts'

const [mode, path] = process.argv.slice(2)
const print = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`)

try {
  if (!path) throw new Error('missing db path')
  const store = await openSqliteStore({ path, payloads: TEST_PAYLOADS })
  const info = {
    versions: { electron: process.versions.electron, node: process.versions.node, sqlite: process.versions.sqlite },
    fts5: store.capabilities.fts5,
  }
  if (mode === 'write') {
    const workspace = await store.sessions.registerWorkspace({ path: '/work/electron' })
    const session = await store.sessions.createSession({ workspaceId: workspace.id, title: 'electron' })
    await store.sessions.appendEntries(session.id, [
      { kind: 'user-message', payload: { text: '你好' }, runId: 'r1' },
      { kind: 'assistant-message', payload: { text: 'hi' }, runId: 'r1' },
    ])
    await store.sessions.appendEntries(session.id, [{ kind: 'tool-result', payload: { ok: true }, runId: 'r1' }])
    print({ ...info, sessionId: session.id, entries: await store.sessions.listEntries(session.id) })
    await store.close()
  } else if (mode === 'read') {
    const sessions = await store.sessions.listSessions()
    const entries = sessions[0] ? await store.sessions.listEntries(sessions[0].id) : []
    print({ ...info, sessions, entries })
    await store.close()
  } else if (mode === 'hold') {
    print({ ...info, ready: true, pid: process.pid, instanceId: store.instanceId })
    process.stdin.resume()
    await new Promise((resolve) => process.stdin.once('end', resolve))
    await store.close()
    print({ closed: true })
  } else {
    throw new Error(`unknown mode ${mode}`)
  }
} catch (error) {
  print({ error: isStoreError(error) ? { code: error.code, fatal: error.fatal, details: error.details } : { message: String(error) } })
  process.exitCode = 2
}
