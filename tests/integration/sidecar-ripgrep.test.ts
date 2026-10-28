// --ripgrep：Sidecar 用给定的 rg 覆盖内置 grep；路径不可执行时 fatal，不回退。
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { rgPath } from '@vscode/ripgrep'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, type SessionEntryRecord } from '@coko/protocol'
import { client, connect, exchange, fauxScript, isRunEnd, sidecarDirs, spawnSidecar, startSidecar, tempDir } from './sidecar-harness.ts'

const args = (dirs: Awaited<ReturnType<typeof sidecarDirs>>, ripgrep: string) => ['--data-dir', dirs.dataDir, '--log-dir', dirs.logDir, '--ripgrep', ripgrep]

async function logRecords(logDir: string): Promise<{ message: string; properties: Record<string, unknown> }[]> {
  const text = await readFile(join(logDir, 'sidecar.jsonl'), 'utf8')
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as { message: string; properties: Record<string, unknown> })
}

describe('Sidecar --ripgrep', () => {
  it.each([
    ['不存在', async (dir: string) => join(dir, 'missing-rg')],
    [
      '不可执行',
      async (dir: string) => {
        const path = join(dir, 'rg')
        await writeFile(path, '#!/bin/sh\n')
        await chmod(path, 0o644)
        return path
      },
    ],
  ])('路径%s时 fatal ripgrep-unavailable 并以 1 退出', async (_label, make) => {
    const dirs = await sidecarDirs()
    const proc = spawnSidecar({ dirs, args: args(dirs, await make(await tempDir())) })
    expect(await proc.waitMessage('fatal')).toMatchObject({ code: 'ripgrep-unavailable' })
    expect((await proc.exited).code).toBe(1)
    expect(proc.messages.some((m) => m.type === 'ready')).toBe(false)
  })

  it('给定可执行的 rg 时 grep 工具经它搜索，日志记录生效实现', async () => {
    const root = await tempDir()
    const workspace = join(root, 'ws')
    await mkdir(workspace)
    await writeFile(join(workspace, 'notes.txt'), 'alpha\nneedle here\n')
    // 包装脚本记录调用后 exec 真实 rg：证明 grep 实际经过给定路径。
    const calls = join(root, 'calls.log')
    const wrapper = join(root, 'rg-wrapper')
    await writeFile(wrapper, `#!/bin/sh\necho "$*" >> '${calls}'\nexec '${rgPath}' "$@"\n`)
    await chmod(wrapper, 0o755)
    const script = await fauxScript(root, {
      responses: [{ content: [{ type: 'toolCall', name: 'grep', id: 'g1', arguments: { pattern: 'needle' } }] }, { content: 'Found it.' }],
    })
    const dirs = await sidecarDirs()
    const sidecar = await startSidecar({ dirs, args: args(dirs, wrapper), env: { COKO_FAUX_SCRIPT: script } })
    const cookie = await exchange(sidecar)
    const api = client(sidecar, cookie)
    const ws = await api.post(API_ROUTES.workspaces, { path: workspace })
    const session = await api.post(API_ROUTES.sessions, { workspaceId: ws.body.id })
    const sessionId = session.body.id as string
    const stream = await connect(sidecar, cookie)
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed')
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'find needle' })).status).toBe(202)
    await stream.waitFor(isRunEnd(sessionId))

    const toolResult = stream.entries(sessionId).find((e: SessionEntryRecord) => (e.payload as { role?: string }).role === 'toolResult')
    expect(toolResult?.payload).toMatchObject({ content: [{ type: 'text', text: 'notes.txt:2: needle here' }] })
    // 一次启动探测（--version）与一次搜索。
    const invoked = (await readFile(calls, 'utf8')).trim().split('\n')
    expect(invoked[0]).toBe('--version')
    expect(invoked.slice(1)).toHaveLength(1)
    expect(invoked[1]).toContain('--regexp needle')

    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
    const selected = (await logRecords(dirs.logDir)).find((record) => record.message === 'grep implementation selected')
    expect(selected?.properties).toMatchObject({ implementation: 'ripgrep', path: wrapper })
    expect(String(selected?.properties.version)).toMatch(/^ripgrep \d+\.\d+\.\d+/)
  })

  it('未给定 --ripgrep 时使用内置 grep，日志记录生效实现；每条记录带 process 与 --app-version 给出的 appVersion', async () => {
    const dirs = await sidecarDirs()
    const sidecar = await startSidecar({ dirs, args: ['--data-dir', dirs.dataDir, '--log-dir', dirs.logDir, '--app-version', '9.8.7'] })
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
    const records = await logRecords(dirs.logDir)
    const selected = records.find((record) => record.message === 'grep implementation selected')
    expect(selected?.properties).toMatchObject({ implementation: 'builtin' })
    expect(records.length).toBeGreaterThan(0)
    expect(records.filter((record) => record.properties.process !== 'sidecar' || record.properties.appVersion !== '9.8.7')).toEqual([])
  })
})
