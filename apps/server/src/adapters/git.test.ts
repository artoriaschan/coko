// 宿主执行的 git：真实 git 与假的可执行文件（经 PATH 只在本测试中替换）。登记 kind git 并在结束后删除；超时终止进程组。
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPayloadRegistry } from '@coko/session'
import { createMemoryStore } from '@coko/session/memory'
import { ProcessRegistry } from '../application/processes.ts'
import { createGitRunner, GIT_TIMEOUT_MS, GitTimeoutError } from './git.ts'

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function temp(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'coko-git-adapter-')))
  dirs.push(dir)
  return dir
}

/** 一个名为 git 的假可执行文件：把环境与参数写进 record 文件，之后按 body 执行。 */
async function fakeGit(body: string, prelude = ''): Promise<{ bin: string; record: string }> {
  const dir = await temp()
  const bin = join(dir, 'bin')
  await mkdir(bin)
  const record = join(dir, 'record.txt')
  await writeFile(
    join(bin, 'git'),
    `#!/bin/sh\n${prelude}echo "pid=$$ prompt=$GIT_TERMINAL_PROMPT lc=$LC_ALL secret=$COKO_SECRET_TOKEN args=$*" > '${record}'\n${body}\n`,
  )
  await chmod(join(bin, 'git'), 0o755)
  return { bin, record }
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('condition not met')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('createGitRunner', () => {
  it('以 argv 运行真实 git：退出码与 stdout；GIT_TERMINAL_PROMPT=0、LC_ALL=C', async () => {
    const store = createMemoryStore({ payloads: createPayloadRegistry([]) })
    const registry = new ProcessRegistry({ store })
    const git = createGitRunner({ env: { PATH: process.env.PATH ?? '' }, track: registry.track })
    const cwd = await temp()
    const outside = await git.run({ args: ['rev-parse', '--show-toplevel'], cwd })
    expect(outside.exitCode).not.toBe(0)
    const init = await git.run({ args: ['init', '-q', '-b', 'main', cwd], cwd })
    expect(init.exitCode).toBe(0)
    const top = await git.run({ args: ['rev-parse', '--show-toplevel'], cwd })
    expect([top.exitCode, top.stdout.trim()]).toEqual([0, cwd])
    // 参数原样传递，不经 shell：分号与 $() 不被解释。
    const literal = await git.run({ args: ['check-ref-format', '--branch', 'a;$(touch x)'], cwd })
    expect(literal.exitCode).not.toBe(0)
  })

  it('登记 kind git（命令为 git 与参数），结束后删除；环境剔除登记外的变量只保留给出的基础环境', async () => {
    const { bin, record } = await fakeGit('sleep 0.3; echo done')
    const store = createMemoryStore({ payloads: createPayloadRegistry([]) })
    const registry = new ProcessRegistry({ store })
    const git = createGitRunner({ env: { PATH: `${bin}:${process.env.PATH ?? ''}`, COKO_SECRET_TOKEN: 'leak' }, track: registry.track })
    const cwd = await temp()
    const running = git.run({ args: ['status', '--porcelain'], cwd })
    await waitFor(async () => (await store.processes.list()).length === 1)
    expect((await store.processes.list()).map((row) => [row.kind, row.command])).toEqual([['git', 'git status --porcelain']])
    const result = await running
    expect([result.exitCode, result.stdout]).toEqual([0, 'done\n'])
    await registry.flush()
    expect(await store.processes.list()).toEqual([])
    const { readFile } = await import('node:fs/promises')
    expect(await readFile(record, 'utf8')).toMatch(/prompt=0 lc=C secret= args=status --porcelain/)
  })

  it.skipIf(process.platform === 'win32')('超时：对进程组 SIGTERM，忽略时 SIGKILL；以 GitTimeoutError 拒绝，登记删除', async () => {
    // trap '' TERM：忽略 SIGTERM，只有 SIGKILL 能结束它（与它启动的子进程同组）。
    const { bin, record } = await fakeGit('sleep 30 &\nwait', "trap '' TERM\n")
    const store = createMemoryStore({ payloads: createPayloadRegistry([]) })
    const registry = new ProcessRegistry({ store })
    const git = createGitRunner({ env: { PATH: `${bin}:${process.env.PATH ?? ''}` }, track: registry.track, killGraceMs: 300 })
    const started = Date.now()
    await expect(git.run({ args: ['fetch'], cwd: await temp(), timeoutMs: 1_500 })).rejects.toBeInstanceOf(GitTimeoutError)
    // 新可执行文件的首次启动在 macOS 上可能要几百毫秒：时限留足启动时间，整体仍远小于缺省 60 秒。
    expect(Date.now() - started).toBeLessThan(10_000)
    const { readFile } = await import('node:fs/promises')
    const pid = Number(/pid=(\d+)/.exec(await readFile(record, 'utf8'))![1])
    await waitFor(async () => {
      try {
        process.kill(-pid, 0)
        return false
      } catch {
        return true
      }
    })
    await registry.flush()
    expect(await store.processes.list()).toEqual([])
  })

  it('缺省时限 60 秒', () => {
    expect(GIT_TIMEOUT_MS).toBe(60_000)
  })
})
