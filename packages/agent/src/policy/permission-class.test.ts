// 权限类与额外读取根经运行时的权限 gate 生效：注册时给出 context-read 的工具在 default 模式下不经审批执行，工具对象自身声明的
// 权限类不生效；readRoots 下的 read 不经审批。
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Type } from 'typebox'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAgentRuntime } from '../engine/runtime.ts'
import type { RunEntry } from '../engine/types.ts'
import { createFauxModels, fauxAssistantMessage, fauxToolCall } from '../testing/faux.ts'
import { createTempWorkspace, type TempWorkspace } from '../testing/workspace.ts'
import { createBuiltinToolRegistry } from '../tools/builtin/index.ts'
import { createLocalExecPort } from '../ports/local-exec.ts'
import type { CokoTool } from '../tools/types.ts'

let ws: TempWorkspace
let outside: string
beforeEach(async () => {
  ws = await createTempWorkspace('coko-class-')
  outside = await mkdtemp(join(tmpdir(), 'coko-skill-'))
})
afterEach(async () => {
  await ws.dispose()
  await rm(outside, { recursive: true, force: true })
})

const tool = (name: string, extra: Record<string, unknown> = {}): CokoTool =>
  ({
    name,
    label: name,
    description: name,
    parameters: Type.Object({}),
    execute: async () => ({ content: [{ type: 'text', text: `${name} ran` }], details: undefined }),
    ...extra,
  }) as CokoTool

async function run(calls: ReturnType<typeof fauxToolCall>[], readRoots?: string[]) {
  const { faux, models, model } = createFauxModels()
  const registry = createBuiltinToolRegistry({ cwd: ws.dir, exec: createLocalExecPort() })
  registry.register(tool('skill'), { permissionClass: 'context-read' })
  registry.register(tool('sneaky', { permissionClass: 'context-read' }))
  const entries: RunEntry[] = []
  const runtime = createAgentRuntime({
    models,
    model,
    cwd: ws.dir,
    tools: registry,
    permissions: { mode: () => 'default', rules: () => [], ...(readRoots ? { readRoots: () => readRoots } : {}) },
    commit: async (entry) => void entries.push(entry),
  })
  faux.setResponses([fauxAssistantMessage(calls, { stopReason: 'toolUse' }), fauxAssistantMessage('done')])
  const pending = runtime.run('go')
  // 等待审批的调用在此拒绝，使 Run 结束。
  const timer = setInterval(() => {
    for (const request of runtime.pendingApprovals) void runtime.answerApproval(request.requestId, { decision: 'deny' }).catch(() => undefined)
  }, 5)
  await pending
  clearInterval(timer)
  return entries.flatMap((e) => (e.kind === 'approval_request' ? [e.payload.toolName] : []))
}

describe('权限类经运行时生效', () => {
  it('注册时给出 context-read 的工具不经审批；工具对象自身声明的不生效', async () => {
    expect(await run([fauxToolCall('skill', {}, { id: 'a' }), fauxToolCall('sneaky', {}, { id: 'b' })])).toEqual(['sneaky'])
  })

  it('readRoots 下的 read 不经审批；未登记时询问', async () => {
    const path = join(outside, 'SKILL.md')
    await writeFile(path, 'skill body')
    expect(await run([fauxToolCall('read', { path }, { id: 'r' })], [outside])).toEqual([])
    expect(await run([fauxToolCall('read', { path }, { id: 'r' })])).toEqual(['read'])
  })
})
