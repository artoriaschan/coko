// M3 上下文装配的 seam：全部领域为空贡献时，faux requestLog 中发给模型的系统提示与 M2 相同；临时 COKO_HOME 经 harness
// 传给 Sidecar，且不出现在 Agent 命令（bash env）的环境中。
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SYSTEM_PROMPT } from '@coko/agent'
import { API_ROUTES, apiPaths, permissionPaths } from '@coko/protocol'
import { client, connect, exchange, fauxScript, isRunEnd, sidecarDirs, startSidecar, tempDir, writeCokoHome } from './sidecar-harness.ts'

describe('上下文装配 seam', () => {
  it('空贡献时系统提示与 M2 相同；COKO_HOME 不进入 bash 环境', async () => {
    const root = await tempDir()
    const dirs = await sidecarDirs()
    // COKO_HOME 中有文件但没有指令文件（指令文件进入系统提示见 sidecar-instructions.test.ts）：请求不变。
    await writeCokoHome(dirs, 'notes.txt', 'not an instruction file\n')
    const requestLog = join(root, 'requests.jsonl')
    await writeFile(requestLog, '')
    const script = await fauxScript(root, {
      requestLog,
      responses: [{ content: [{ type: 'toolCall', name: 'bash', id: 'env1', arguments: { command: 'env' } }] }, { content: 'done' }],
    })
    const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
    const cookie = await exchange(sidecar)
    const api = client(sidecar, cookie)
    const stream = await connect(sidecar, cookie)
    const workspace = (await api.post(API_ROUTES.workspaces, { path: root })).body
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.id })).body.id as string
    expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })).status).toBe(200)
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'hello' })).status).toBe(202)
    await stream.waitFor(isRunEnd(sessionId))

    const requests = (await readFile(requestLog, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { role: string; content: unknown; sections?: unknown; toolsAdded?: unknown }[])
    expect(requests).toHaveLength(2)
    for (const messages of requests) {
      const leading = messages[0]!
      // M2 的形状：开头的系统消息只有基础提示，没有 sections。
      expect(leading.role).toBe('system')
      expect(leading.content).toBe(DEFAULT_SYSTEM_PROMPT)
      expect(leading).not.toHaveProperty('sections')
      expect(messages.filter((m) => m.role === 'system')).toHaveLength(1)
    }

    const result = stream.entries(sessionId).find((e) => e.kind === 'message' && (e.payload as { role: string }).role === 'toolResult')
    const output = JSON.stringify(result?.payload)
    expect(output).toContain('PATH=')
    expect(output).not.toContain('COKO_HOME')
    expect(output).not.toContain(dirs.cokoHome)
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})
