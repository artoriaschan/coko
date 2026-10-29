// 指令贡献（票 03）：report() 给出已加载文件、字符数、截断与诊断；instructions.enabled 为 false 时不注入。
import { mkdir } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createInstructionLoader, createNodeInstructionFiles, defaultCapabilityConfig, INSTRUCTION_FILE_MAX_CHARS } from '@coko/agent'
import { createTempWorkspace, type TempWorkspace } from '@coko/agent/testing'
import { instructionsContribution } from './instructions.ts'
import type { ContextScope } from './types.ts'

let ws: TempWorkspace
beforeEach(async () => {
  ws = await createTempWorkspace('coko-instr-contrib-')
  await mkdir(ws.path('home'))
})
afterEach(async () => {
  await ws.dispose()
})

const contribution = () =>
  instructionsContribution(
    { cokoHome: ws.path('coko-home') },
    { loader: createInstructionLoader({ files: createNodeInstructionFiles(), homeDir: ws.path('home') }) },
  )
const scope = (enabled = true): ContextScope => {
  const config = defaultCapabilityConfig()
  config.instructions.enabled = enabled
  return { workspaceId: 'w1', cwd: ws.path('repo'), config, cokoHome: ws.path('coko-home') }
}

describe('instructionsContribution', () => {
  it('report() 返回已加载文件（路径、作用域、字符数、截断）、分项字符数与诊断', async () => {
    await ws.write('coko-home/AGENTS.md', 'user rules')
    await ws.write('repo/.git/HEAD', 'ref')
    await ws.write('repo/AGENTS.md', '@./missing.md\n' + 'x'.repeat(INSTRUCTION_FILE_MAX_CHARS + 1))
    const c = contribution()
    const report = await c.report!(scope())
    expect(report.instructions).toEqual([
      { path: ws.path('coko-home/AGENTS.md'), scope: 'user', chars: 10, truncated: false },
      { path: ws.path('repo/AGENTS.md'), scope: 'project', chars: expect.any(Number), truncated: true },
    ])
    expect(report.diagnostics!.map((d) => [d.source, d.code, d.path])).toEqual([
      ['instructions', 'file-truncated', ws.path('repo/AGENTS.md')],
      ['instructions', 'import-not-found', ws.path('repo/AGENTS.md')],
    ])
    const [section] = await c.systemSections!(scope())
    expect(section!.name).toBe('instructions')
    expect(report.breakdown).toEqual({ instructions: section!.text.length })
  })

  it('instructions.enabled 为 false：没有 system section、没有 hook，report 为空', async () => {
    await ws.write('repo/AGENTS.md', 'rules')
    const c = contribution()
    expect(await c.systemSections!(scope(false))).toEqual([])
    expect(c.hooks!(scope(false))).toEqual([])
    expect(await c.report!(scope(false))).toEqual({ breakdown: { instructions: 0 }, instructions: [], diagnostics: [] })
    expect(await c.systemSections!(scope(true))).toHaveLength(1)
    expect(c.hooks!(scope(true))).toHaveLength(1)
  })

  it('没有任何指令文件时没有 system section', async () => {
    await mkdir(ws.path('repo'))
    expect(await contribution().systemSections!(scope())).toEqual([])
  })
})
