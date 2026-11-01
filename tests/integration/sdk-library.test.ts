// @coko/agent 作为库使用（packages/agent/README.md 的"作为库使用"）：只经公共入口 @coko/agent、@coko/agent/testing 与 @coko/session 的内存实现
// 运行一次带工具调用的 Run（内置工具、内存 Repository、faux 模型、权限 gate 与审批、事件订阅），断言结构化结果、事件顺序与提交的条目。
// 导入守卫：本文件不深层导入 packages/*/src。不启动 Sidecar。
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createAgentRuntime, createBuiltinToolRegistry, createLocalExecPort, SESSION_ENTRY_PAYLOADS, type RunEntry, type RuntimeEvent } from '@coko/agent'
import { createFauxModels, createTempWorkspace, fauxAssistantMessage, fauxToolCall, type TempWorkspace } from '@coko/agent/testing'
import { createPayloadRegistry, type NewSessionEntry } from '@coko/session'
import { createMemoryStore } from '@coko/session/memory'

let ws: TempWorkspace | undefined
afterEach(async () => {
  await ws?.dispose()
  ws = undefined
})

describe('SDK：@coko/agent 作为库', () => {
  it('带工具调用的 Run：write 经审批后执行，结构化结果、事件顺序与内存 Repository 中的条目一致', async () => {
    ws = await createTempWorkspace('coko-sdk-')
    // 内存 Repository：payload 按 agent 的注册表校验（与 Sidecar 相同）。
    const store = createMemoryStore({ payloads: createPayloadRegistry(SESSION_ENTRY_PAYLOADS) })
    const workspace = await store.sessions.registerWorkspace({ path: ws.dir })
    const session = await store.sessions.createSession({ workspaceId: workspace.id, title: 'sdk', model: null })
    // 模型：faux（无密钥）；真实使用时为 createModelRegistry({ credentials, providers }) 与 resolveModel。
    const { faux, models, model } = createFauxModels()
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('write', { path: 'hello.txt', content: 'hi' }, { id: 'w1' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('wrote hello.txt'),
    ])
    const runtime = createAgentRuntime({
      models,
      model,
      cwd: ws.dir,
      sessionId: session.id,
      tools: createBuiltinToolRegistry({ cwd: ws.dir, exec: createLocalExecPort() }),
      // 每条条目先入库，Run 才继续。
      // payload 是 JSON 值（条目 schema 保证），Repository 的输入类型为 NewSessionEntry。
      commit: async (entry) => void (await store.sessions.appendEntries(session.id, [entry as NewSessionEntry])),
      permissions: { mode: () => 'default', rules: () => [] },
    })
    const events: RuntimeEvent[] = []
    runtime.subscribe((event) => {
      events.push(event)
      // 宿主的审批通道：这里直接批准。
      if (event.kind === 'entry' && event.entry.kind === 'approval_request') void runtime.answerApproval(event.entry.payload.requestId, { decision: 'allow' })
    })

    const result = await runtime.run('write hello.txt')

    expect(result).toEqual({ runId: expect.any(String), status: 'completed' })
    expect(await readFile(ws.path('hello.txt'), 'utf8')).toBe('hi')
    const label = (entry: RunEntry) => (entry.kind === 'message' ? (entry.payload as { role: string }).role : entry.kind)
    const committed = events.flatMap((e) => (e.kind === 'entry' ? [label(e.entry)] : []))
    expect(committed).toEqual([
      'run_start',
      'user',
      'assistant',
      'model_request',
      'approval_request',
      'approval_decision',
      'tool_exec',
      'toolResult',
      'assistant',
      'model_request',
      'run_end',
    ])
    const progress = events.flatMap((e) => (e.kind === 'progress' ? [e.event.type] : []))
    expect(progress[0]).toBe('run_start')
    expect(progress.at(-1)).toBe('run_end')
    expect(progress.indexOf('tool_start')).toBeLessThan(progress.indexOf('tool_end'))
    // 读回：内存 Repository 中的条目与事件一致，带 seq 与 runId。
    const stored = await store.sessions.listEntries(session.id)
    expect(stored.map((e) => (e.kind === 'message' ? (e.payload as { role: string }).role : e.kind))).toEqual(committed)
    expect(stored.map((e) => e.seq)).toEqual(committed.map((_, i) => i + 1))
    expect(new Set(stored.map((e) => e.runId))).toEqual(new Set([result.runId]))
    expect(stored.find((e) => e.kind === 'approval_decision')?.payload).toMatchObject({ outcome: 'allowed', scope: 'once' })
  })

  it('导入守卫：只用公共入口，不深层导入 packages/*/src', async () => {
    const source = await readFile(fileURLToPath(import.meta.url), 'utf8')
    const specifiers = [...source.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]!)
    expect(specifiers.filter((s) => s.startsWith('@coko/'))).toEqual(['@coko/agent', '@coko/agent/testing', '@coko/session', '@coko/session/memory'])
    expect(specifiers.filter((s) => s.includes('packages/') || s.includes('/src/') || s.startsWith('.'))).toEqual([])
  })
})
