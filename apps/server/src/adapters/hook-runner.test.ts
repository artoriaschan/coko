// Hook 执行端口（ADR 0013）：真实子进程（仓库内的 Hook 夹具），断言 stdin、退出码、输出上限、环境与超时后的进程组终止。
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createHookRunner, HOOK_OUTPUT_MAX_BYTES } from './hook-runner.ts'
import { processAlive } from './processes.ts'
import type { TrackedProcess } from '../application/processes.ts'

const fixture = fileURLToPath(new URL('../../../../tests/fixtures/hooks/hook.mjs', import.meta.url))
const quote = (part: string) => `'${part.replaceAll("'", "'\\''")}'`
const hook = (...args: string[]) => [process.execPath, fixture, ...args].map(quote).join(' ')
// 夹具以 Node 运行：Electron 的 Node 需要 ELECTRON_RUN_AS_NODE。
const baseEnv = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ELECTRON_RUN_AS_NODE: '1' }

describe.skipIf(process.platform !== 'darwin')('createHookRunner（Hook 进程组与信号只在 darwin 上验证）', () => {
  it('stdin 收到一行 JSON；退出码、stdout 与 stderr 原样；登记 kind hook，退出后释放', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'coko-hook-runner-'))
    const record = join(dir, 'stdin.jsonl')
    const tracked: TrackedProcess[] = []
    let released = 0
    const runner = createHookRunner({ env: baseEnv, track: (p) => (tracked.push(p), () => void released++) })
    const outcome = await runner.run({
      command: hook('--record', record, '--exit', '2', '--stdout', 'out', '--stderr', 'err'),
      cwd: dir,
      env: { COKO_HOOK_EVENT: 'PreToolUse' },
      input: JSON.stringify({ hook_event_name: 'PreToolUse' }),
      timeoutMs: 10_000,
      sessionId: 's1',
    })
    expect([outcome.exitCode, outcome.stdout, outcome.stderr, outcome.timedOut]).toEqual([2, 'out', 'err', false])
    expect(await readFile(record, 'utf8')).toBe('{"hook_event_name":"PreToolUse"}\n')
    expect(tracked.map(({ kind, sessionId, pgid, pid }) => ({ kind, sessionId, grouped: pgid === pid }))).toEqual([
      { kind: 'hook', sessionId: 's1', grouped: true },
    ])
    expect(released).toBe(1)
  })

  it('环境：去掉 COKO_* 与凭据形态的变量，另有 COKO_PROJECT_DIR / COKO_SESSION_ID / COKO_HOOK_EVENT；cwd 为请求的目录', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'coko-hook-env-'))
    const runner = createHookRunner({ env: { ...baseEnv, COKO_SECRET_DB: 'sk-should-not-leak', OPENAI_API_KEY: 'k', GITHUB_TOKEN: 't', KEEP_ME: 'yes' } })
    const outcome = await runner.run({
      command: 'env | sort; pwd -P',
      cwd: dir,
      env: { COKO_PROJECT_DIR: dir, COKO_SESSION_ID: 's1', COKO_HOOK_EVENT: 'Stop' },
      input: '{}',
      timeoutMs: 10_000,
    })
    const lines = outcome.stdout.trim().split('\n')
    expect(lines).toEqual(expect.arrayContaining(['KEEP_ME=yes', `COKO_PROJECT_DIR=${dir}`, 'COKO_SESSION_ID=s1', 'COKO_HOOK_EVENT=Stop']))
    expect(outcome.stdout).not.toMatch(/sk-should-not-leak|OPENAI_API_KEY|GITHUB_TOKEN/)
    expect(lines.at(-1)).toMatch(/coko-hook-env-/)
  })

  it('stdout 与 stderr 各保留前 64 KB', async () => {
    const runner = createHookRunner({ env: baseEnv })
    const outcome = await runner.run({
      command: 'head -c 200000 /dev/zero | tr "\\0" a; head -c 70000 /dev/zero | tr "\\0" b >&2',
      cwd: tmpdir(),
      env: {},
      input: '{}',
      timeoutMs: 10_000,
    })
    expect([outcome.stdout.length, outcome.stderr.length, outcome.exitCode]).toEqual([HOOK_OUTPUT_MAX_BYTES, HOOK_OUTPUT_MAX_BYTES, 0])
  })

  it('超时：忽略 SIGTERM 的 Hook 在宽限后被 SIGKILL，进程组在 timeout + 2 秒内消失，之后才释放登记', async () => {
    const tracked: TrackedProcess[] = []
    let releasedAlive: boolean | undefined
    const runner = createHookRunner({
      env: baseEnv,
      killGraceMs: 2_000,
      track: (p) => (tracked.push(p), () => void (releasedAlive = processAlive({ pid: p.pid, pgid: p.pgid }))),
    })
    const started = Date.now()
    const outcome = await runner.run({ command: hook('--sleep', '30000', '--ignore-term'), cwd: tmpdir(), env: {}, input: '{}', timeoutMs: 500 })
    const elapsed = Date.now() - started
    expect(outcome.timedOut).toBe(true)
    // SIGTERM 被忽略：至少经过宽限（不是 SIGTERM 结束的），且在 timeout + 2 秒（加轮询余量）内结束。
    expect(elapsed).toBeGreaterThanOrEqual(500 + 2_000 - 50)
    expect(elapsed).toBeLessThan(500 + 2_000 + 1_000)
    expect(processAlive({ pid: tracked[0]!.pid, pgid: tracked[0]!.pgid })).toBe(false)
    expect(releasedAlive).toBe(false)
  })

  it('中止信号终止进程组', async () => {
    const controller = new AbortController()
    const runner = createHookRunner({ env: baseEnv, killGraceMs: 500 })
    const pending = runner.run({ command: hook('--sleep', '30000'), cwd: tmpdir(), env: {}, input: '{}', timeoutMs: 60_000, signal: controller.signal })
    setTimeout(() => controller.abort(), 100)
    const outcome = await pending
    expect([outcome.timedOut, outcome.exitCode]).toEqual([false, null])
  })
})
