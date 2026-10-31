// 外部 Hook 的纯逻辑（ADR 0013）：配置解析与诊断、matcher 与 if、输出解释、聚合与组合表。表驱动。
import { describe, expect, it } from 'vitest'
import { decideWithStep, type PermissionContext, type SteppedDecision } from '../../policy/decide.ts'
import { hookDigest, hookTimeoutMs, parseHooksConfig, type HookCondition } from './config.ts'
import { aggregateVerdict, combinePreToolUse, type SourcedHookResult } from './combine.ts'
import { matcherMatches, selectHooks } from './matcher.ts'
import { interpretHookResult, type HookProcessResult } from './output.ts'
import type { HookVerdict } from './types.ts'

const cmd = (command: string, extra: Record<string, unknown> = {}) => ({ type: 'command', command, ...extra })

describe('parseHooksConfig', () => {
  it('加载 command 型 Hook：hookId 为来源 + 事件 + 位置，digest 覆盖 event / matcher / if / command / timeout', () => {
    const parsed = parseHooksConfig(
      { PreToolUse: [{ matcher: 'Bash', hooks: [cmd('guard.sh', { if: 'Bash(rm *)', timeout: 5 })] }], Stop: [{ hooks: [cmd('stop.sh')] }] },
      'project',
    )
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.hooks.map((h) => [h.hookId, h.event, h.matcher, h.if, h.condition, h.command, h.timeout])).toEqual([
      ['project:PreToolUse:0:0', 'PreToolUse', 'Bash', 'Bash(rm *)', { tool: 'Bash', content: 'rm *' }, 'guard.sh', 5],
      ['project:Stop:0:0', 'Stop', undefined, undefined, undefined, 'stop.sh', undefined],
    ])
    const base = { event: 'PreToolUse' as const, matcher: 'Bash', if: 'Bash(rm *)', command: 'guard.sh', timeout: 5 }
    expect(parsed.hooks[0]!.digest).toBe(hookDigest(base))
    for (const change of [{ event: 'PostToolUse' as const }, { matcher: 'Edit' }, { if: 'Bash(git *)' }, { command: 'guard2.sh' }, { timeout: 6 }])
      expect(hookDigest({ ...base, ...change })).not.toBe(parsed.hooks[0]!.digest)
  })

  it('插件来源（ADR 0017）：hookId 带插件名，LoadedHook 记 plugin，诊断的 source 为 plugin', () => {
    const parsed = parseHooksConfig({ PreToolUse: [{ matcher: 'Bash', hooks: [cmd('guard.sh')] }], Bogus: [] }, 'plugin', {
      plugin: 'sample',
      path: '/p/hooks.json',
    })
    expect(parsed.hooks.map((h) => [h.hookId, h.source, h.plugin])).toEqual([['plugin:sample:PreToolUse:0:0', 'plugin', 'sample']])
    expect(parsed.diagnostics).toEqual([expect.objectContaining({ source: 'plugin', code: 'unknown-event', path: '/p/hooks.json' })])
  })

  it.each([
    ['未知 type 被忽略，其余照常加载', { PreToolUse: [{ hooks: [{ type: 'prompt', prompt: 'x' }, cmd('ok.sh')] }] }, ['unsupported-hook-type'], 1],
    ['未知事件', { SessionStart: [{ hooks: [cmd('x')] }] }, ['unknown-event'], 0],
    ['非法正则 matcher：整组忽略', { PreToolUse: [{ matcher: '(', hooks: [cmd('x')] }] }, ['invalid-matcher'], 0],
    ['非字符串 matcher', { PreToolUse: [{ matcher: 3, hooks: [cmd('x')] }] }, ['invalid-matcher'], 0],
    [
      '团队事件（TaskCreated / TaskCompleted / TeammateIdle）照常加载',
      { TaskCreated: [{ hooks: [cmd('a')] }], TaskCompleted: [{ hooks: [cmd('b')] }], TeammateIdle: [{ hooks: [cmd('c')] }] },
      [],
      3,
    ],
    [
      '团队事件写了 matcher：整组忽略',
      { TaskCreated: [{ matcher: 'x', hooks: [cmd('x')] }], TeammateIdle: [{ matcher: '*', hooks: [cmd('y')] }] },
      ['invalid-matcher', 'invalid-matcher'],
      0,
    ],
    ['非法 if', { PreToolUse: [{ hooks: [cmd('x', { if: 'Bash(' })] }] }, ['invalid-if'], 0],
    ['空命令', { PreToolUse: [{ hooks: [cmd('  ')] }] }, ['invalid-value'], 0],
    ['超时越界', { PreToolUse: [{ hooks: [cmd('x', { timeout: 601 })] }] }, ['invalid-value'], 0],
    ['事件值不是数组', { PreToolUse: {} }, ['invalid-value'], 0],
    ['组没有 hooks 数组', { PreToolUse: [{ matcher: 'Bash' }] }, ['invalid-value'], 0],
    ['根不是对象', ['x'], ['invalid-value'], 0],
    ['enabled 不是事件（能力开关）', { enabled: false, Stop: [{ hooks: [cmd('x')] }] }, [], 1],
  ])('%s', (_name, value, codes, loaded) => {
    const parsed = parseHooksConfig(value, 'global', { path: '/p/.coko/settings.json' })
    expect(parsed.diagnostics.map((d) => d.code)).toEqual(codes)
    expect(parsed.diagnostics.every((d) => d.source === 'config' && d.path === '/p/.coko/settings.json')).toBe(true)
    expect(parsed.hooks).toHaveLength(loaded)
  })

  it('宿主注入的规则解析决定 if 是否合法', () => {
    const parseRule = (text: string): HookCondition | undefined => (text === 'Bash(ok)' ? { tool: 'Bash', content: 'ok' } : undefined)
    const parsed = parseHooksConfig({ PreToolUse: [{ hooks: [cmd('a', { if: 'Bash(ok)' }), cmd('b', { if: 'Bash(no)' })] }] }, 'global', { parseRule })
    expect(parsed.hooks.map((h) => h.command)).toEqual(['a'])
    expect(parsed.diagnostics.map((d) => d.code)).toEqual(['invalid-if'])
  })

  it('超时：缺省 60 秒，Notification 10 秒，配置值优先', () => {
    expect(hookTimeoutMs({ event: 'PreToolUse' })).toBe(60_000)
    expect(hookTimeoutMs({ event: 'Notification' })).toBe(10_000)
    expect(hookTimeoutMs({ event: 'Notification', timeout: 3 })).toBe(3_000)
  })
})

describe('matcher', () => {
  it.each([
    [undefined, ['bash', 'Bash'], true],
    ['', ['bash', 'Bash'], true],
    ['*', ['bash', 'Bash'], true],
    ['Bash', ['bash', 'Bash'], true],
    ['bash', ['bash', 'Bash'], true],
    ['Edit|Bash', ['bash', 'Bash'], true],
    ['Edit|Write', ['write', 'Edit'], true],
    ['Edit', ['bash', 'Bash'], false],
    ['Bas', ['bash', 'Bash'], false],
    ['mcp__.*', ['mcp__fs__read', 'mcp__fs__read'], true],
    ['^mcp__git__', ['mcp__fs__read', 'mcp__fs__read'], false],
    ['memory_.*', ['memory_write', 'Memory'], true],
  ])('%s 对 %j → %s', (matcher, names, expected) => {
    expect(matcherMatches(matcher, names)).toBe(expected)
  })

  it('if：按与拒绝规则相同的匹配器；Bash(git *) 命中 cd x && git push，Bash(rm *) 命中 echo ok && rm x', () => {
    const context: PermissionContext = { mode: 'default', rules: [], workspace: '/w', writableRoots: ['/w'], home: '/h' }
    const matches = (command: string) => (condition: HookCondition) =>
      decideWithStep({ toolName: 'bash', subject: command }, { ...context, rules: [{ behavior: 'deny', ...condition }] }).step === 'deny-rule'
    const { hooks } = parseHooksConfig(
      { PreToolUse: [{ matcher: 'Bash', hooks: [cmd('git-guard', { if: 'Bash(git *)' }), cmd('rm-guard', { if: 'Bash(rm *)' }), cmd('all')] }] },
      'global',
    )
    const pick = (command: string) => selectHooks(hooks, 'PreToolUse', { names: ['bash', 'Bash'], matchesRule: matches(command) }).map((h) => h.command)
    expect(pick('cd x && git push')).toEqual(['git-guard', 'all'])
    expect(pick('echo ok && rm x')).toEqual(['rm-guard', 'all'])
    expect(pick('ls')).toEqual(['all'])
    // 没有匹配器时带 if 的 Hook 不运行；其他事件不按名字过滤时全部运行。
    expect(selectHooks(hooks, 'PreToolUse', { names: ['bash'] }).map((h) => h.command)).toEqual(['all'])
    expect(selectHooks(hooks, 'PostToolUse', { names: ['bash'] })).toEqual([])
  })
})

const proc = (over: Partial<HookProcessResult>): HookProcessResult => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false, durationMs: 1, ...over })
const json = (value: unknown) => JSON.stringify(value)
const pre = (decision: string, reason?: string) =>
  json({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason } })

describe('interpretHookResult', () => {
  it.each([
    [
      'PreToolUse exit 2：拒绝，stderr 为原因',
      'PreToolUse',
      proc({ exitCode: 2, stderr: 'no rm\n' }),
      { outcome: 'blocked', decision: 'deny', reason: 'no rm' },
    ],
    ['PreToolUse JSON deny', 'PreToolUse', proc({ stdout: pre('deny', 'nope') }), { outcome: 'blocked', decision: 'deny', reason: 'nope' }],
    ['PreToolUse JSON ask', 'PreToolUse', proc({ stdout: pre('ask', 'check') }), { outcome: 'asked', decision: 'ask', reason: 'check' }],
    ['PreToolUse JSON allow', 'PreToolUse', proc({ stdout: pre('allow') }), { outcome: 'allowed', decision: 'allow' }],
    [
      'PreToolUse 旧写法 decision block',
      'PreToolUse',
      proc({ stdout: json({ decision: 'block', reason: 'r' }) }),
      { outcome: 'blocked', decision: 'deny', reason: 'r' },
    ],
    ['PreToolUse 非法决定值：非法输出', 'PreToolUse', proc({ stdout: pre('yes') }), { outcome: 'invalid-output' }],
    ['exit 0 而 stdout 不是 JSON：非法输出', 'PreToolUse', proc({ stdout: 'hello' }), { outcome: 'invalid-output' }],
    ['exit 0 而 stdout 是数组：非法输出', 'PreToolUse', proc({ stdout: '[]' }), { outcome: 'invalid-output' }],
    ['exit 0 无输出：没有结果', 'PreToolUse', proc({}), {}],
    ['exit 0 JSON 没有决定：没有结果', 'PreToolUse', proc({ stdout: '{}' }), {}],
    ['非 0 非 2：出错、没有决定', 'PreToolUse', proc({ exitCode: 1, stderr: 'boom' }), { outcome: 'error', reason: 'boom' }],
    ['被信号终止：出错', 'PreToolUse', proc({ exitCode: null }), { outcome: 'error' }],
    ['超时：没有决定', 'PreToolUse', proc({ timedOut: true, exitCode: null, stdout: pre('deny') }), { outcome: 'timeout' }],
    ['启动失败', 'PreToolUse', proc({ error: 'spawn ENOENT', exitCode: null }), { outcome: 'error', reason: 'spawn ENOENT' }],
    [
      'PermissionRequest allow',
      'PermissionRequest',
      proc({ stdout: json({ hookSpecificOutput: { decision: { behavior: 'allow' } } }) }),
      { outcome: 'allowed', decision: 'allow' },
    ],
    [
      'PermissionRequest deny',
      'PermissionRequest',
      proc({ stdout: json({ hookSpecificOutput: { decision: { behavior: 'deny', message: 'm' } } }) }),
      { outcome: 'denied', decision: 'deny', reason: 'm' },
    ],
    [
      'PermissionRequest 非法 behavior',
      'PermissionRequest',
      proc({ stdout: json({ hookSpecificOutput: { decision: { behavior: 'ask' } } }) }),
      { outcome: 'invalid-output' },
    ],
    ['PermissionRequest exit 2：拒绝', 'PermissionRequest', proc({ exitCode: 2, stderr: 'x' }), { outcome: 'blocked', decision: 'deny', reason: 'x' }],
    ['PostToolUse exit 2：stderr 追加', 'PostToolUse', proc({ exitCode: 2, stderr: 'fix lint' }), { outcome: 'context', context: 'fix lint' }],
    [
      'PostToolUse additionalContext',
      'PostToolUse',
      proc({ stdout: json({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'note' } }) }),
      { outcome: 'context', context: 'note' },
    ],
    ['PostToolUse 的 permissionDecision 不是决定', 'PostToolUse', proc({ stdout: pre('allow') }), {}],
    [
      'continue false：停止',
      'PreToolUse',
      proc({ stdout: json({ continue: false, stopReason: 'enough' }) }),
      { outcome: 'stopped', stop: true, stopReason: 'enough' },
    ],
    [
      'systemMessage 只显示给用户',
      'PreToolUse',
      proc({ stdout: json({ systemMessage: 'hi', ...JSON.parse(pre('allow')) }) }),
      { outcome: 'allowed', decision: 'allow', systemMessage: 'hi' },
    ],
    ['PreCompact：stdout 文本', 'PreCompact', proc({ stdout: 'keep the API list' }), { outcome: 'context', text: 'keep the API list' }],
    ['Stop exit 2：阻断', 'Stop', proc({ exitCode: 2, stderr: 'go on' }), { outcome: 'blocked', block: true, reason: 'go on' }],
    [
      'Stop decision block + reason',
      'Stop',
      proc({ stdout: json({ decision: 'block', reason: 'tests fail' }) }),
      { outcome: 'blocked', block: true, reason: 'tests fail' },
    ],
    [
      'UserPromptSubmit additionalContext',
      'UserPromptSubmit',
      proc({ stdout: json({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'branch main' } }) }),
      { outcome: 'context', context: 'branch main' },
    ],
    ['UserPromptSubmit 的纯文本 stdout 不是上下文', 'UserPromptSubmit', proc({ stdout: 'plain text' }), { outcome: 'invalid-output' }],
    ['UserPromptSubmit continue false', 'UserPromptSubmit', proc({ stdout: json({ continue: false }) }), { outcome: 'stopped', stop: true }],
    ['PreCompact exit 2：阻断', 'PreCompact', proc({ exitCode: 2, stderr: 'not now' }), { outcome: 'blocked', block: true, reason: 'not now' }],
    ['PreCompact 的 JSON stdout 也按文本', 'PreCompact', proc({ stdout: json({ continue: false }) }), { outcome: 'context', text: '{"continue":false}' }],
    ['Notification exit 2 不阻断', 'Notification', proc({ exitCode: 2, stderr: 'x' }), {}],
    ['Notification 忽略 stdout（含 continue false）', 'Notification', proc({ stdout: json({ continue: false, decision: 'block' }) }), {}],
    ['Notification 失败照常记录', 'Notification', proc({ exitCode: 1, stderr: 'boom' }), { outcome: 'error', reason: 'boom' }],
    ['Notification 超时照常记录', 'Notification', proc({ timedOut: true, exitCode: null }), { outcome: 'timeout' }],
  ] as const)('%s', (_name, event, result, expected) => {
    expect(interpretHookResult(event, result)).toEqual(expected)
  })
})

const sourced = (hookId: string, source: 'global' | 'project', decision?: 'allow' | 'deny' | 'ask', reason?: string): SourcedHookResult => ({
  hookId,
  source,
  command: `cmd-${hookId}`,
  result: { ...(decision ? { decision } : {}), ...(reason ? { reason } : {}) },
})

describe('aggregateVerdict', () => {
  it.each([
    [
      'deny 胜过 allow',
      [sourced('a', 'global', 'allow'), sourced('d', 'global', 'deny', 'no')],
      { decision: 'deny', reason: 'no', source: 'global', hookId: 'd', command: 'cmd-d' },
    ],
    ['deny 胜过 ask', [sourced('k', 'global', 'ask'), sourced('d', 'project', 'deny')], { decision: 'deny', source: 'project', hookId: 'd', command: 'cmd-d' }],
    [
      'ask 胜过 allow',
      [sourced('a', 'global', 'allow'), sourced('k', 'global', 'ask', 'why')],
      { decision: 'ask', reason: 'why', source: 'global', hookId: 'k', command: 'cmd-k' },
    ],
    [
      '同一决定的原因按顺序连接',
      [sourced('d1', 'global', 'deny', 'x'), sourced('d2', 'global', 'deny', 'y')],
      { decision: 'deny', reason: 'x\ny', source: 'global', hookId: 'd1', command: 'cmd-d1' },
    ],
    ['项目 Hook 的 allow 不参与', [sourced('p', 'project', 'allow')], {}],
    [
      '项目 allow 被忽略后取全局 allow',
      [sourced('p', 'project', 'allow'), sourced('g', 'global', 'allow')],
      { decision: 'allow', source: 'global', hookId: 'g', command: 'cmd-g' },
    ],
    ['没有决定', [sourced('n', 'global')], {}],
  ])('%s', (_name, results, expected) => {
    expect(aggregateVerdict(results)).toEqual(expected)
  })
})

describe('combinePreToolUse（组合表）', () => {
  const ask = (
    step: SteppedDecision['step'],
    reason: 'ask-rule' | 'protected-path' | 'outside-writable-roots' | 'approval-required' = 'approval-required',
  ): SteppedDecision => ({
    step,
    decision: { behavior: 'ask', reason, suggestions: step === 'default' ? [{ behavior: 'allow', tool: 'Bash', content: 'x' }] : [] },
  })
  const allow = (step: SteppedDecision['step'] = 'mode'): SteppedDecision => ({ step, decision: { behavior: 'allow' } })
  const deny: SteppedDecision = { step: 'deny-rule', decision: { behavior: 'deny', rule: { behavior: 'deny', tool: 'Bash', content: 'rm *' } } }
  const H = (decision?: 'allow' | 'deny' | 'ask'): HookVerdict => (decision ? { decision, reason: 'r', source: 'global' } : {})
  const shape = (c: ReturnType<typeof combinePreToolUse>) =>
    c.behavior === 'ask' ? `ask:${c.by}:${c.decision.suggestions.length}` : c.behavior === 'deny' ? `deny:${c.by}` : `allow:${c.by}`

  it.each([
    ['H deny 优先于一切（P allow）', H('deny'), allow(), false, 'deny:hook'],
    ['H deny 优先于 P deny', H('deny'), deny, false, 'deny:hook'],
    ['H deny 优先于提权', H('deny'), allow(), true, 'deny:hook'],
    ['P deny（H allow）', H('allow'), deny, false, 'deny:rule'],
    ['P 询问来自询问规则：H allow 无效', H('allow'), ask('ask-rule', 'ask-rule'), false, 'ask:policy:0'],
    ['P 询问来自受保护路径：H allow 无效', H('allow'), ask('protected', 'protected-path'), false, 'ask:policy:0'],
    ['P 询问来自越出可写根：H allow 无效', H('allow'), ask('outside-writable', 'outside-writable-roots'), false, 'ask:policy:0'],
    ['plan-exit（mode 步的询问，forced）：H allow 无效', H('allow'), ask('mode'), true, 'ask:policy:0'],
    ['提权（P allow，forced）：H allow 不改变，交由提权询问', H('allow'), allow(), true, 'allow:policy'],
    ['H ask 在 P allow（full-access）时询问，没有建议规则', H('ask'), allow(), false, 'ask:hook:0'],
    ['H ask 在第 7 步询问时：去掉建议规则', H('ask'), ask('default'), false, 'ask:hook:0'],
    ['H ask 不改变第 2–4 步的询问', H('ask'), ask('ask-rule', 'ask-rule'), false, 'ask:policy:0'],
    ['H allow 免掉第 7 步的询问（与允许规则同位）', H('allow'), ask('default'), false, 'allow:hook'],
    ['H allow 在 P allow 时', H('allow'), allow(), false, 'allow:policy'],
    ['没有 H：按 P 询问（保留建议）', H(), ask('default'), false, 'ask:policy:1'],
    ['没有 H：按 P 允许', H(), allow('allow-rule'), false, 'allow:policy'],
    ['没有 H：按 P 拒绝', H(), deny, false, 'deny:rule'],
  ] as const)('%s', (_name, hook, policy, forced, expected) => {
    expect(shape(combinePreToolUse(hook, policy, forced))).toBe(expected)
  })

  it('Hook 拒绝的文本为 Blocked by hook: <reason>', () => {
    expect(combinePreToolUse({ decision: 'deny', reason: 'no rm' }, allow())).toEqual({ behavior: 'deny', by: 'hook', reason: 'Blocked by hook: no rm' })
    expect(combinePreToolUse({ decision: 'deny' }, allow())).toEqual({ behavior: 'deny', by: 'hook', reason: 'Blocked by hook: no reason given' })
  })
})
