// HookService 的生命周期事件在子 Session（子代理，ADR 0014）中的边界：Stop 与 UserPromptSubmit 只在根 Session 运行（子 Session 的结束归
// SubagentStop）。执行端口为记录调用的替身；配置为一条全局 Hook。
import { describe, expect, it } from 'vitest'
import type { CapabilityConfig } from '@coko/agent'
import type { HookRunner } from '../adapters/hook-runner.ts'
import { HookService, type HookScope } from './hooks.ts'

function service(hooks: Record<string, unknown>) {
  const ran: string[] = []
  const runner: HookRunner = {
    run: async (request) => {
      ran.push(request.env.COKO_HOOK_EVENT ?? '')
      return { exitCode: 2, stdout: '', stderr: 'keep going', timedOut: false, durationMs: 1 }
    },
  } as HookRunner
  const store = { settings: { get: async (key: string) => (key === 'hooks' ? { key, value: hooks, revision: 1 } : undefined) } }
  const config = { effective: async () => ({ hooks: { enabled: true } }), projectHooks: async () => ({ path: '/w/.coko/settings.json', hooks: undefined }) }
  return { ran, hooks: new HookService({ store, config, runner } as unknown as ConstructorParameters<typeof HookService>[0]) }
}

const scope = (extra: Partial<HookScope> = {}): HookScope => ({
  workspaceId: 'w',
  cwd: '/w',
  sessionId: 's',
  config: { hooks: { enabled: true } } as unknown as CapabilityConfig,
  ...extra,
})
const cmd = { hooks: [{ type: 'command', command: 'x' }] }

describe('HookService：子 Session', () => {
  it('Stop 与 UserPromptSubmit 在根 Session 运行，在子 Session 不运行', async () => {
    const { ran, hooks } = service({ Stop: [cmd], UserPromptSubmit: [cmd] })
    const info = { runId: 'r', trigger: 'submit' as const, continuations: 0, stopHookActive: false }
    const root = scope()
    expect(await hooks.stop(root, hooks.runState(root), info)).toEqual({ continue: [{ type: 'text', text: 'Stop hook feedback:\nkeep going' }] })
    expect(await hooks.userPromptSubmit(root, hooks.runState(root), 'hi')).toEqual({ reject: 'keep going' })
    expect(ran).toEqual(['Stop', 'UserPromptSubmit'])

    const child = scope({ sessionId: 'c', parentSessionId: 's', subagent: { name: 'explore' } })
    expect(await hooks.stop(child, hooks.runState(child), { ...info, trigger: 'subagent' })).toBeUndefined()
    expect(await hooks.stop(child, hooks.runState(child), info)).toBeUndefined()
    expect(await hooks.userPromptSubmit(child, hooks.runState(child), 'hi')).toBeUndefined()
    expect(ran).toEqual(['Stop', 'UserPromptSubmit'])
  })
})
