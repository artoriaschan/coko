// 秘密不外泄总闸的 LSP 通道（ADR 0007）：登记的 Secret LSP_GATE（独立运行，COKO_SECRET_LSP_GATE）不经环境进入语言服务器（HOST_ENV_EXCLUSIONS 剔除
// COKO_*）。服务器（包装假服务器的脚本，从测试目录的文件读到同一个值）把它写进 stderr 并作为 hover 的回答，回答后退出。lsp 的工具结果、stderr 尾部
// （/api/lsp 的 stderrTail 与 lsp_update）在入库、推送与显示前替换为标记；扫描 faux requestLog、WebSocket 帧、HTTP 响应体、库文件（含 -wal）、
// sidecar.jsonl 与 Sidecar stderr 中都没有明文。发给语言服务器的是用户本机进程收到的文件内容，不属于本闸门的扫描范围。
import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, lspPaths, permissionPaths, type LspResponse } from '@coko/protocol'
import { connect, exchange, fauxScript, lspFixturePath, pollUntil, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'
import { leaksIn, persisted, recordingClient } from './secrets-gate-harness.ts'

describe('秘密不外泄总闸：LSP', () => {
  it('hover 结果与 stderr 尾部中的登记值被替换；requestLog、条目、HTTP、WS、库与日志中没有明文', { timeout: 120_000 }, async () => {
    // 不是凭据形态：只能靠登记的值按值脱敏。
    const value = `lsp-gate-${randomBytes(12).toString('hex')}`
    const root = await tempDir()
    const dirs = await sidecarDirs()
    await writeFile(join(root, 'a.ts'), 'let a = 1\n')
    const valueFile = join(root, 'value.txt')
    await writeFile(valueFile, value)
    const wrapper = join(root, 'leaky.mjs')
    await writeFile(
      wrapper,
      `import { readFileSync } from 'node:fs'
const value = readFileSync(${JSON.stringify(valueFile)}, 'utf8')
process.stderr.write('server token ' + value + '\\n')
process.argv.push('--hover', 'secret is ' + value, '--crash-after', '2')
await import(${JSON.stringify(pathToFileURL(lspFixturePath).href)})
`,
    )
    const requestLog = join(root, 'requests.jsonl')
    await writeFile(requestLog, '')
    const script = await fauxScript(root, {
      requestLog,
      responses: [
        { content: [{ type: 'toolCall', name: 'lsp', id: 'h1', arguments: { operation: 'hover', file_path: 'a.ts', line: 1, character: 1 } }] },
        { content: 'done' },
      ],
    })
    const sidecar = await startSidecar({ dirs, ipc: false, env: { COKO_FAUX_SCRIPT: script, COKO_SECRET_LSP_GATE: value } })
    const cookie = await exchange(sidecar)
    const bodies: string[] = []
    const api = recordingClient(sidecar, cookie, bodies)
    const stream = await connect(sidecar, cookie)
    const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id as string
    expect(
      (
        await api.put(lspPaths.lsp, {
          scope: 'global',
          servers: { ts: { command: process.execPath, args: [wrapper], extensionToLanguage: { '.ts': 'typescript' } } },
          expectedRevision: 0,
        })
      ).status,
    ).toBe(200)
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })).status).toBe(200)
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'hover' })
    await stream.waitFor(() => stream.entries(sessionId).some((e) => e.kind === 'run_end'), 30_000)

    const result = stream.entries(sessionId).find((e) => e.kind === 'message' && (e.payload as { toolCallId?: string }).toolCallId === 'h1')!
    const text = (result.payload as { content: { text?: string }[] }).content.map((c) => c.text ?? '').join('')
    // 前置：服务器确实回答了含该值的 hover（结果中为替换后的标记）。
    expect(text).toMatch(/^secret is \[REDACTED[^\]]*\]$/)
    // stderr 尾部：服务器回答后退出，尾部经脱敏显示。
    const status = await pollUntil(
      async () => {
        const servers = ((await api.get(lspPaths.status(sessionId))).body as LspResponse).status
        return servers[0]?.stderrTail ? servers[0] : undefined
      },
      { timeoutMs: 10_000, what: 'stderr tail' },
    )
    expect(status!.stderrTail).toMatch(/^server token \[REDACTED[^\]]*\]$/)
    await pollUntil(
      () => stream.messages.some((m) => m.type === 'progress' && m.event.type === 'lsp_update' && JSON.stringify(m.event).includes('server token')),
      {
        timeoutMs: 5_000,
        what: 'lsp_update with the stderr tail',
      },
    )
    expect(stream.invalidEntries).toEqual([])

    const running = await persisted(dirs)
    // 独立运行：SIGTERM 触发有序关闭。
    sidecar.child.kill('SIGTERM')
    expect(await sidecar.exited).toEqual({ code: 0, signal: null })
    const stopped = await persisted(dirs)
    const requests = (await readFile(requestLog, 'utf8')).split('\n').filter(Boolean)
    expect(requests).toHaveLength(2)
    expect(requests[1]).toContain('secret is [REDACTED')
    const channels: [string, string | Buffer][] = [
      ...requests.map((line, i): [string, string] => [`model request ${i}`, line]),
      ...stream.frames.map((frame, i): [string, string] => [`ws frame ${i}`, frame]),
      ...bodies.map((body, i): [string, string] => [`http body ${i}`, body]),
      ...running.map((f): [string, Buffer] => [`running ${f.name}`, f.bytes]),
      ...stopped.map((f): [string, Buffer] => [`stopped ${f.name}`, f.bytes]),
      ['sidecar stderr', sidecar.stderr()],
    ]
    expect(leaksIn(channels, { 'registered secret': value })).toEqual([])
  })
})
