import { describe, expect, it } from 'vitest'
import { permissionEntryPayloads, type PermissionRule } from '../session-entries/index.ts'
import { canonicalRuleTool, decide, decideWithStep, type DecisionStep, type PermissionCall, type PermissionContext } from './decide.ts'

const WS = '/ws/project'
const TMP = '/private/tmp'

const ctx = (overrides: Partial<PermissionContext> = {}): PermissionContext => ({
  mode: 'default',
  rules: [],
  workspace: WS,
  writableRoots: [WS, TMP],
  ...overrides,
})

/** 文件工具的调用：subject 原样，目标为解析后的绝对路径（resolved 与 real 相同，除非另给）。 */
const file = (toolName: string, subject: string, resolved: string, real = resolved): PermissionCall => ({ toolName, subject, target: { resolved, real } })
const bash = (command: string): PermissionCall => ({ toolName: 'bash', subject: command })

const rule = (behavior: PermissionRule['behavior'], tool: string, content?: string): PermissionRule => ({
  behavior,
  tool,
  ...(content === undefined ? {} : { content }),
})

describe('权限判定（default 模式）', () => {
  it.each<[string, PermissionCall, PermissionContext, string, string?]>([
    // Workspace 内外读取
    ['Workspace 内读取放行', file('read', 'src/a.ts', `${WS}/src/a.ts`), ctx(), 'allow'],
    ['grep / find / ls 的默认目录是 Workspace', file('ls', '.', WS), ctx(), 'allow'],
    ['Workspace 外读取询问', file('read', '/etc/hosts', '/etc/hosts'), ctx(), 'ask', 'outside-workspace'],
    ['相对路径越出 Workspace 询问', file('grep', '../other', '/ws/other'), ctx(), 'ask', 'outside-workspace'],
    ['同名前缀的兄弟目录不算 Workspace 内', file('read', '/ws/project-secrets/k', '/ws/project-secrets/k'), ctx(), 'ask', 'outside-workspace'],
    [
      'Workspace 内的符号链接指向外部时按真实路径询问',
      file('read', 'link/id_rsa', `${WS}/link/id_rsa`, '/Users/me/.ssh/id_rsa'),
      ctx(),
      'ask',
      'outside-workspace',
    ],
    // 写入与命令
    ['Workspace 内 write 询问', file('write', 'a.txt', `${WS}/a.txt`), ctx(), 'ask', 'approval-required'],
    ['Workspace 内 edit 询问', file('edit', 'a.txt', `${WS}/a.txt`), ctx(), 'ask', 'approval-required'],
    ['bash 询问', bash('ls'), ctx(), 'ask', 'approval-required'],
    ['越出可写根的 write 询问', file('write', '/etc/x', '/etc/x'), ctx(), 'ask', 'outside-writable-roots'],
    ['临时目录是可写根', file('write', '/private/tmp/x', '/private/tmp/x'), ctx(), 'ask', 'approval-required'],
    // 受保护路径（任何模式都询问；比较前转小写）
    ['Workspace 内 .git 写入', file('write', '.git/config', `${WS}/.git/config`), ctx(), 'ask', 'protected-path'],
    ['.GIT 大小写变体', file('edit', '.GIT/config', `${WS}/.GIT/config`), ctx(), 'ask', 'protected-path'],
    ['.Git 嵌套在子目录', file('write', 'vendor/lib/.Git/HEAD', `${WS}/vendor/lib/.Git/HEAD`), ctx(), 'ask', 'protected-path'],
    ['.coko / .vscode / .idea', file('write', '.VSCode/settings.json', `${WS}/.VSCode/settings.json`), ctx(), 'ask', 'protected-path'],
    ['经符号链接写入 .git', file('write', 'gitlink/config', `${WS}/gitlink/config`, `${WS}/.git/config`), ctx(), 'ask', 'protected-path'],
    ['任意位置的 .bashrc（可写根内）', file('write', '/private/tmp/home/.BashRC', '/private/tmp/home/.BashRC'), ctx(), 'ask', 'protected-path'],
    ['任意位置的 .ssh 目录', file('write', 'x/.SSH/authorized_keys', `${WS}/x/.SSH/authorized_keys`), ctx(), 'ask', 'protected-path'],
    ['.mcp.json', file('edit', '.mcp.json', `${WS}/.mcp.json`), ctx(), 'ask', 'protected-path'],
    ['读取受保护路径不受此检查', file('read', '.git/config', `${WS}/.git/config`), ctx(), 'allow'],
    ['普通的 .gitignore 不是受保护路径', file('write', '.gitignore', `${WS}/.gitignore`), ctx(), 'ask', 'approval-required'],
    // 未知工具
    ['未知宿主工具询问', { toolName: 'deploy' }, ctx(), 'ask', 'approval-required'],
    ['声明了路径的未知工具也询问', { toolName: 'lint', subject: 'src' }, ctx(), 'ask', 'approval-required'],
  ])('%s', (_name, call, context, behavior, reason) => {
    expect(decide(call, context)).toMatchObject(reason === undefined ? { behavior } : { behavior, reason })
  })

  it('拒绝规则前置于 Workspace 内读取的放行', () => {
    expect(decide(file('read', 'src/a.ts', `${WS}/src/a.ts`), ctx({ rules: [rule('deny', 'Read')] }))).toMatchObject({
      behavior: 'deny',
      rule: rule('deny', 'Read'),
    })
  })

  it('拒绝规则前置于询问规则与受保护路径', () => {
    const rules = [rule('ask', 'Edit'), rule('deny', 'Edit', '.git/config')]
    expect(decide(file('write', '.git/config', `${WS}/.git/config`), ctx({ rules }))).toMatchObject({ behavior: 'deny' })
  })

  it('询问规则前置于模式放行', () => {
    expect(decide(file('grep', 'src', `${WS}/src`), ctx({ rules: [rule('ask', 'Read', 'src')] }))).toMatchObject({ behavior: 'ask', reason: 'ask-rule' })
  })

  it('允许规则放行 bash；规则按工具组匹配（Bash、Read、Edit），未知工具按原名', () => {
    expect(decide(bash('npm test'), ctx({ rules: [rule('allow', 'Bash', 'npm test')] }))).toMatchObject({ behavior: 'allow' })
    expect(decide(bash('npm run build'), ctx({ rules: [rule('allow', 'Bash', 'npm test')] }))).toMatchObject({ behavior: 'ask' })
    expect(decide({ toolName: 'deploy' }, ctx({ rules: [rule('allow', 'deploy')] }))).toMatchObject({ behavior: 'allow' })
    expect(decide({ toolName: 'deploy' }, ctx({ rules: [rule('allow', 'Bash')] }))).toMatchObject({ behavior: 'ask' })
    expect(decide(file('find', '/etc', '/etc'), ctx({ rules: [rule('allow', 'Read', '/etc')] }))).toMatchObject({ behavior: 'allow' })
  })

  it('允许规则不能免掉受保护路径与越出可写根的写入', () => {
    const allowAll = [rule('allow', 'Edit')]
    expect(decide(file('write', '.git/config', `${WS}/.git/config`), ctx({ rules: allowAll }))).toMatchObject({ behavior: 'ask', reason: 'protected-path' })
    expect(decide(file('write', '/etc/x', '/etc/x'), ctx({ rules: allowAll }))).toMatchObject({ behavior: 'ask', reason: 'outside-writable-roots' })
    expect(decide(file('write', 'a.txt', `${WS}/a.txt`), ctx({ rules: allowAll }))).toMatchObject({ behavior: 'allow' })
  })

  it('建议规则：命令与未知工具可保存；Workspace 内写入按相对路径；受保护与越界写入没有建议', () => {
    const suggestions = (call: PermissionCall) => {
      const decision = decide(call, ctx())
      return decision.behavior === 'ask' ? decision.suggestions : undefined
    }
    expect(suggestions(bash('npm test'))).toEqual([rule('allow', 'Bash', 'npm test')])
    expect(suggestions({ toolName: 'deploy' })).toEqual([rule('allow', 'deploy')])
    expect(suggestions(file('edit', './src/a.ts', `${WS}/src/a.ts`))).toEqual([rule('allow', 'Edit', 'src/a.ts')])
    expect(suggestions(file('read', '/etc/hosts', '/etc/hosts'))).toEqual([rule('allow', 'Read', '/etc/hosts')])
    expect(suggestions(file('write', '.git/config', `${WS}/.git/config`))).toEqual([])
    expect(suggestions(file('write', '/etc/x', '/etc/x'))).toEqual([])
  })

  it('文件工具没有目标时询问且没有建议', () => {
    expect(decide({ toolName: 'write' }, ctx())).toEqual({ behavior: 'ask', reason: 'approval-required', suggestions: [] })
  })
})

describe('四种模式 × 工具类型（ADR 0005）', () => {
  const roots: Record<PermissionContext['mode'], string[]> = { 'read-only': [], default: [WS, TMP], 'accept-edits': [WS, TMP], 'full-access': ['/'], plan: [] }
  const at = (mode: PermissionContext['mode'], rules: PermissionRule[] = []) => ctx({ mode, rules, writableRoots: roots[mode] })
  type Expect = 'allow' | 'deny' | `ask:${string}`
  const outcome = (call: PermissionCall, context: PermissionContext): Expect => {
    const decision = decide(call, context)
    return decision.behavior === 'ask' ? `ask:${decision.reason}` : decision.behavior
  }

  it.each<[string, PermissionCall, Expect, Expect, Expect, Expect]>([
    // 名称, 调用, read-only, default, accept-edits, full-access
    ['Workspace 内读取', file('read', 'a.ts', `${WS}/a.ts`), 'allow', 'allow', 'allow', 'allow'],
    ['Workspace 外读取', file('read', '/etc/hosts', '/etc/hosts'), 'ask:outside-workspace', 'ask:outside-workspace', 'ask:outside-workspace', 'allow'],
    ['Workspace 内写入', file('write', 'a.ts', `${WS}/a.ts`), 'ask:outside-writable-roots', 'ask:approval-required', 'allow', 'allow'],
    ['Workspace 内 edit', file('edit', 'a.ts', `${WS}/a.ts`), 'ask:outside-writable-roots', 'ask:approval-required', 'allow', 'allow'],
    ['临时目录写入', file('write', '/private/tmp/x', '/private/tmp/x'), 'ask:outside-writable-roots', 'ask:approval-required', 'allow', 'allow'],
    ['可写根之外写入', file('write', '/etc/x', '/etc/x'), 'ask:outside-writable-roots', 'ask:outside-writable-roots', 'ask:outside-writable-roots', 'allow'],
    [
      '受保护路径写入',
      file('write', '.git/config', `${WS}/.git/config`),
      'ask:protected-path',
      'ask:protected-path',
      'ask:protected-path',
      'ask:protected-path',
    ],
    ['bash', bash('make'), 'ask:approval-required', 'ask:approval-required', 'ask:approval-required', 'allow'],
    ['未知工具', { toolName: 'deploy' }, 'ask:approval-required', 'ask:approval-required', 'ask:approval-required', 'allow'],
  ])('%s', (_name, call, readOnly, normal, acceptEdits, fullAccess) => {
    expect([outcome(call, at('read-only')), outcome(call, at('default')), outcome(call, at('accept-edits')), outcome(call, at('full-access'))]).toEqual([
      readOnly,
      normal,
      acceptEdits,
      fullAccess,
    ])
  })

  it('拒绝规则与询问规则在 full-access 下仍生效', () => {
    const rules = [rule('deny', 'Bash', 'rm *'), rule('deny', 'Read', '.env'), rule('ask', 'Edit', 'package.json')]
    expect(outcome(bash('rm -rf build'), at('full-access', rules))).toBe('deny')
    expect(outcome(file('read', '.env', `${WS}/.env`), at('full-access', rules))).toBe('deny')
    expect(outcome(file('edit', 'package.json', `${WS}/package.json`), at('full-access', rules))).toBe('ask:ask-rule')
  })

  it('受保护路径不被允许规则免除（含 accept-edits 与 full-access）', () => {
    const rules = [rule('allow', 'Edit'), rule('allow', 'Edit', '.git/**')]
    for (const mode of ['accept-edits', 'full-access'] as const)
      expect(outcome(file('edit', '.git/HEAD', `${WS}/.git/HEAD`), at(mode, rules))).toBe('ask:protected-path')
  })

  it('越出可写根的写入不提供可保存的建议（read-only 的 Workspace 内写入也是）', () => {
    const decision = decide(file('write', 'a.ts', `${WS}/a.ts`), at('read-only'))
    expect(decision).toEqual({ behavior: 'ask', reason: 'outside-writable-roots', suggestions: [] })
  })
})

describe('规则工具名的大小写与别名（拒绝规则不能因写法而失效）', () => {
  it.each<[string, PermissionRule, PermissionCall]>([
    ['deny bash(rm *) 拦下 rm -rf x', rule('deny', 'bash', 'rm *'), bash('rm -rf x')],
    ['deny BASH(rm *)', rule('deny', 'BASH', 'rm *'), bash('rm -rf x')],
    ['deny Write(secret.txt) 拦下 write', rule('deny', 'Write', 'secret.txt'), file('write', 'secret.txt', `${WS}/secret.txt`)],
    ['deny edit(secret.txt) 拦下 write（同属 Edit 组）', rule('deny', 'edit', 'secret.txt'), file('write', 'secret.txt', `${WS}/secret.txt`)],
    ['deny grep(secret.txt) 拦下 read（同属 Read 组）', rule('deny', 'grep', 'secret.txt'), file('read', 'secret.txt', `${WS}/secret.txt`)],
    ['deny read 拦下 ls', rule('deny', 'read'), file('ls', '.', WS)],
  ])('%s（full-access 下）', (_name, denyRule, call) => {
    expect(decide(call, ctx({ mode: 'full-access', rules: [denyRule], writableRoots: ['/'] })).behavior).toBe('deny')
  })

  it('canonicalRuleTool：内置工具与组名归一为组名；其余按已知工具名不区分大小写归一，未知时返回 undefined', () => {
    expect(['bash', 'Bash', 'BASH'].map((n) => canonicalRuleTool(n))).toEqual(['Bash', 'Bash', 'Bash'])
    expect(['write', 'Edit', 'EDIT', 'edit'].map((n) => canonicalRuleTool(n))).toEqual(['Edit', 'Edit', 'Edit', 'Edit'])
    expect(['read', 'grep', 'Find', 'LS', 'Read'].map((n) => canonicalRuleTool(n))).toEqual(['Read', 'Read', 'Read', 'Read', 'Read'])
    expect(canonicalRuleTool('Secret_Probe', ['secret_probe'])).toBe('secret_probe')
    expect(canonicalRuleTool('deploy', ['secret_probe'])).toBeUndefined()
  })
})

describe('权限类（M3）', () => {
  const MODES = ['read-only', 'default', 'accept-edits', 'full-access'] as const
  const allIn = (mode: (typeof MODES)[number]) => ctx({ mode, writableRoots: mode === 'read-only' ? [] : mode === 'full-access' ? ['/'] : [WS, TMP] })
  const call = (toolName: string, permissionClass: PermissionCall['permissionClass']): PermissionCall => ({
    toolName,
    ...(permissionClass ? { permissionClass } : {}),
  })

  it('context-read：四种模式都放行；deny 规则仍生效', () => {
    for (const name of ['skill', 'memory_list', 'list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource'])
      expect(MODES.map((mode) => decide(call(name, 'context-read'), allIn(mode)).behavior)).toEqual(['allow', 'allow', 'allow', 'allow'])
    expect(decide(call('skill', 'context-read'), ctx({ mode: 'full-access', rules: [rule('deny', 'skill')] })).behavior).toBe('deny')
  })

  it('skill：规则名 Skill（未注册时也接受），内容为 Skill 名', () => {
    expect(canonicalRuleTool('Skill')).toBe('Skill')
    expect(canonicalRuleTool('skill')).toBe('Skill')
    const pdf: PermissionCall = { toolName: 'skill', permissionClass: 'context-read', subject: 'pdf' }
    expect(decide(pdf, ctx({ mode: 'full-access', rules: [rule('deny', 'Skill', 'pdf')] })).behavior).toBe('deny')
    expect(decide(pdf, ctx({ rules: [rule('deny', 'Skill', 'other')] })).behavior).toBe('allow')
    expect(decide(pdf, ctx({ mode: 'full-access', rules: [rule('ask', 'Skill', 'pdf')] }))).toMatchObject({ behavior: 'ask', reason: 'ask-rule' })
  })

  it('memory-write：只在 accept-edits 与 full-access 放行；规则组名 Memory', () => {
    expect(MODES.map((mode) => decide(call('memory_write', 'memory-write'), allIn(mode)).behavior)).toEqual(['ask', 'ask', 'allow', 'allow'])
    expect(decide(call('memory_delete', 'memory-write'), ctx())).toMatchObject({ behavior: 'ask', suggestions: [{ behavior: 'allow', tool: 'Memory' }] })
    expect(decide(call('memory_delete', 'memory-write'), ctx({ rules: [rule('allow', 'memory')] })).behavior).toBe('allow')
    expect(decide(call('memory_write', 'memory-write'), ctx({ mode: 'full-access', rules: [rule('deny', 'Memory')] })).behavior).toBe('deny')
    expect(canonicalRuleTool('memory')).toBe('Memory')
  })

  it('external（mcp__*）：只在 full-access 放行；未注册时按名字也是 external', () => {
    expect(MODES.map((mode) => decide(call('mcp__srv__x', 'external'), allIn(mode)).behavior)).toEqual(['ask', 'ask', 'ask', 'allow'])
    expect(MODES.map((mode) => decide(call('mcp__srv__x', undefined), allIn(mode)).behavior)).toEqual(['ask', 'ask', 'ask', 'allow'])
    expect(decide(call('mcp__srv__x', 'external'), ctx())).toMatchObject({ behavior: 'ask', suggestions: [{ behavior: 'allow', tool: 'mcp__srv__x' }] })
  })

  it('规则 mcp__srv 匹配 mcp__srv__x，不匹配 mcp__srv2__x', () => {
    const allowServer = ctx({ rules: [rule('allow', 'mcp__srv')] })
    expect(decide(call('mcp__srv__x', 'external'), allowServer).behavior).toBe('allow')
    expect(decide(call('mcp__srv2__x', 'external'), allowServer).behavior).toBe('ask')
    const denyServer = ctx({ mode: 'full-access', writableRoots: ['/'], rules: [rule('deny', 'MCP__SRV')] })
    expect(decide(call('mcp__srv__x', 'external'), denyServer).behavior).toBe('deny')
    expect(decide(call('mcp__srv2__x', 'external'), denyServer).behavior).toBe('allow')
    // 精确到工具的规则只匹配该工具。
    expect(decide(call('mcp__srv__y', 'external'), ctx({ rules: [rule('allow', 'mcp__srv__x')] })).behavior).toBe('ask')
  })

  it('未注册的 mcp__ 名字作为规则工具名被接受（不报 unknown-tool）；裸前缀不接受', () => {
    expect(canonicalRuleTool('mcp__srv')).toBe('mcp__srv')
    expect(canonicalRuleTool('mcp__srv__tool', [])).toBe('mcp__srv__tool')
    expect(canonicalRuleTool('mcp__')).toBeUndefined()
  })

  it('readRoots 下的读取与 Workspace 内读取同样处理', () => {
    // ~/.agents/skills 下的 Skill（~/.coko 下的路径另受 .coko 受保护段约束）。
    const SKILL = '/Users/me/.agents/skills/review'
    const withRoots = (mode: (typeof MODES)[number]) => ({ ...allIn(mode), readRoots: [SKILL] })
    const readSkill = file('read', `${SKILL}/notes.md`, `${SKILL}/notes.md`)
    expect(MODES.map((mode) => decide(readSkill, withRoots(mode)).behavior)).toEqual(
      MODES.map((mode) => decide(file('read', 'a', `${WS}/a`), allIn(mode)).behavior),
    )
    expect(decide(file('grep', SKILL, SKILL), withRoots('default')).behavior).toBe('allow')
    // 没有登记为读取根时照旧询问；Read 拒绝规则仍生效；不放开写入与命令。
    expect(decide(readSkill, ctx())).toMatchObject({ behavior: 'ask', reason: 'outside-workspace' })
    expect(decide(readSkill, { ...withRoots('default'), rules: [rule('deny', 'Read', `${SKILL}/**`)] }).behavior).toBe('deny')
    expect(decide(file('write', `${SKILL}/x`, `${SKILL}/x`), withRoots('accept-edits'))).toMatchObject({ behavior: 'ask', reason: 'outside-writable-roots' })
  })

  it('session-state：每种模式都放行（放行与模式无关）；deny 与 ask 规则仍生效', () => {
    for (const name of ['todo_write', 'create_goal', 'update_goal', 'job_kill'])
      expect(MODES.map((mode) => decide(call(name, 'session-state'), allIn(mode)).behavior)).toEqual(['allow', 'allow', 'allow', 'allow'])
    expect(decide(call('job_kill', 'session-state'), ctx({ mode: 'full-access', rules: [rule('deny', 'job_kill')] }))).toMatchObject({
      behavior: 'deny',
      rule: { tool: 'job_kill' },
    })
    expect(decide(call('todo_write', 'session-state'), allIn('read-only'))).toEqual({ behavior: 'allow' })
    expect(decide(call('update_goal', 'session-state'), ctx({ rules: [rule('ask', 'update_goal')] }))).toMatchObject({ behavior: 'ask', reason: 'ask-rule' })
  })

  it('plan-exit：每种模式都询问且不建议规则；允许规则不生效，拒绝规则生效', () => {
    expect(MODES.map((mode) => decide(call('exit_plan_mode', 'plan-exit'), allIn(mode)))).toEqual(
      MODES.map(() => ({ behavior: 'ask', reason: 'approval-required', suggestions: [] })),
    )
    for (const allow of [rule('allow', 'exit_plan_mode'), rule('allow', 'exit_plan_mode', 'anything')])
      expect(decide(call('exit_plan_mode', 'plan-exit'), ctx({ mode: 'full-access', writableRoots: ['/'], rules: [allow] })).behavior).toBe('ask')
    expect(decide(call('exit_plan_mode', 'plan-exit'), ctx({ rules: [rule('deny', 'exit_plan_mode')] })).behavior).toBe('deny')
  })

  it('内置工具名不受宿主给出的权限类影响', () => {
    expect(decide(call('bash', 'context-read'), ctx()).behavior).toBe('ask')
    expect(decide({ ...file('write', 'a', `${WS}/a`), permissionClass: 'context-read' }, ctx()).behavior).toBe('ask')
  })
})

describe('plan 模式（Plan Mode，ADR 0005）', () => {
  // plan 与 read-only 的可写根都为空（sandbox.ts 的推导）。
  const at = (mode: 'plan' | 'read-only', rules: PermissionRule[] = [], readRoots?: string[]) =>
    ctx({ mode, rules, writableRoots: [], ...(readRoots ? { readRoots } : {}) })
  const SKILL = '/Users/me/.agents/skills/review'

  it.each<[string, PermissionCall]>([
    ['Workspace 内读取', file('read', 'a.ts', `${WS}/a.ts`)],
    ['grep Workspace', file('grep', '.', WS)],
    ['Workspace 外读取', file('read', '/etc/hosts', '/etc/hosts')],
    ['额外读取根内的读取', file('read', `${SKILL}/notes.md`, `${SKILL}/notes.md`)],
    ['Workspace 内写入', file('write', 'a.ts', `${WS}/a.ts`)],
    ['Workspace 内 edit', file('edit', 'a.ts', `${WS}/a.ts`)],
    ['受保护路径写入', file('write', '.git/config', `${WS}/.git/config`)],
    ['bash', bash('ls')],
    ['未知工具', { toolName: 'deploy' }],
    ['context-read', { toolName: 'memory_list', permissionClass: 'context-read' }],
    ['memory-write', { toolName: 'memory_write', permissionClass: 'memory-write' }],
    ['external', { toolName: 'mcp__srv__x', permissionClass: 'external' }],
    ['session-state', { toolName: 'todo_write', permissionClass: 'session-state' }],
  ])('%s：与 read-only 的判定相同', (_name, call) => {
    expect(decide(call, at('plan', [], [SKILL]))).toEqual(decide(call, at('read-only', [], [SKILL])))
  })

  it('读取放行、写入与命令询问（不放行写入；可保存的建议与 read-only 相同）', () => {
    expect(decide(file('read', 'a.ts', `${WS}/a.ts`), at('plan')).behavior).toBe('allow')
    expect(decide(file('write', 'a.ts', `${WS}/a.ts`), at('plan'))).toEqual({ behavior: 'ask', reason: 'outside-writable-roots', suggestions: [] })
    expect(decide(bash('touch x'), at('plan'))).toMatchObject({ behavior: 'ask', reason: 'approval-required' })
  })

  it('session-state 在 plan 中放行；deny 规则仍生效', () => {
    for (const name of ['todo_write', 'create_goal', 'update_goal', 'job_kill'])
      expect(decide({ toolName: name, permissionClass: 'session-state' }, at('plan'))).toEqual({ behavior: 'allow' })
    expect(decide({ toolName: 'job_kill', permissionClass: 'session-state' }, at('plan', [rule('deny', 'job_kill')])).behavior).toBe('deny')
  })

  it('plan-exit 在 plan 中询问且没有建议；允许规则不生效，拒绝规则生效', () => {
    const exit: PermissionCall = { toolName: 'exit_plan_mode', permissionClass: 'plan-exit' }
    expect(decide(exit, at('plan'))).toEqual({ behavior: 'ask', reason: 'approval-required', suggestions: [] })
    expect(decide(exit, at('plan', [rule('allow', 'exit_plan_mode')])).behavior).toBe('ask')
    expect(decide(exit, at('plan', [rule('deny', 'exit_plan_mode')])).behavior).toBe('deny')
  })

  it('允许规则在 plan 中照常生效（与 read-only 相同），拒绝与询问规则同样前置', () => {
    expect(decide(bash('git status'), at('plan', [rule('allow', 'Bash', 'git status')])).behavior).toBe('allow')
    expect(decide(file('read', 'a.ts', `${WS}/a.ts`), at('plan', [rule('deny', 'Read')])).behavior).toBe('deny')
    expect(decide(file('read', 'a.ts', `${WS}/a.ts`), at('plan', [rule('ask', 'Read')]))).toMatchObject({ behavior: 'ask', reason: 'ask-rule' })
  })
})

describe('permission_mode 条目的版本', () => {
  const definition = permissionEntryPayloads.find((d) => d.kind === 'permission_mode')!
  const [v1, v2] = definition.versions

  it('v1 的四档读回为 v2（原样迁移）；v1 不接受 plan 与 prior', () => {
    expect(definition.versions).toHaveLength(2)
    for (const mode of ['read-only', 'default', 'accept-edits', 'full-access']) {
      expect(v1!.check({ mode })).toBeUndefined()
      const migrated = v2!.migrate!({ mode })
      expect(migrated).toEqual({ mode })
      expect(v2!.check(migrated)).toBeUndefined()
    }
    expect(v1!.check({ mode: 'plan' })).toBeDefined()
    expect(v1!.check({ mode: 'default', prior: 'default' })).toBeDefined()
  })

  it('v2：plan 可带 prior（四档之一）；prior 不能是 plan', () => {
    expect(v2!.check({ mode: 'plan', prior: 'accept-edits' })).toBeUndefined()
    expect(v2!.check({ mode: 'plan' })).toBeUndefined()
    expect(v2!.check({ mode: 'plan', prior: 'plan' })).toBeDefined()
  })
})

describe('判定步骤（decideWithStep）', () => {
  const allowAll = [rule('allow', 'Edit'), rule('allow', 'Bash')]
  it.each<[string, PermissionCall, PermissionContext, DecisionStep, string]>([
    ['拒绝规则', bash('rm -rf x'), ctx({ rules: [rule('deny', 'Bash', 'rm *')] }), 'deny-rule', 'deny'],
    ['拒绝规则先于受保护路径', file('write', '.git/config', `${WS}/.git/config`), ctx({ rules: [rule('deny', 'Edit')] }), 'deny-rule', 'deny'],
    ['询问规则', bash('git push'), ctx({ mode: 'full-access', writableRoots: ['/'], rules: [rule('ask', 'Bash', 'git push')] }), 'ask-rule', 'ask'],
    [
      '受保护路径（full-access 与允许规则下也询问）',
      file('write', '.git/HEAD', `${WS}/.git/HEAD`),
      ctx({ mode: 'full-access', writableRoots: ['/'], rules: allowAll }),
      'protected',
      'ask',
    ],
    ['越出可写根的写入', file('write', '/etc/x', '/etc/x'), ctx({ rules: allowAll }), 'outside-writable', 'ask'],
    ['没有目标的写入', { toolName: 'write' }, ctx({ rules: allowAll }), 'outside-writable', 'ask'],
    ['模式放行', file('read', 'a', `${WS}/a`), ctx(), 'mode', 'allow'],
    [
      'plan-exit 的总询问在模式这一步',
      { toolName: 'exit_plan_mode', permissionClass: 'plan-exit' },
      ctx({ rules: [rule('allow', 'exit_plan_mode')] }),
      'mode',
      'ask',
    ],
    ['允许规则', bash('npm test'), ctx({ rules: [rule('allow', 'Bash', 'npm test')] }), 'allow-rule', 'allow'],
    ['模式与规则都没有放行', bash('npm test'), ctx(), 'default', 'ask'],
    ['Workspace 外的读取', file('read', '/etc/hosts', '/etc/hosts'), ctx(), 'default', 'ask'],
  ])('%s', (_name, call, context, step, behavior) => {
    const result = decideWithStep(call, context)
    expect([result.step, result.decision.behavior]).toEqual([step, behavior])
    expect(decide(call, context)).toEqual(result.decision)
  })
})

describe('权限类（M5）：agent 与 automation', () => {
  const MODES = ['read-only', 'plan', 'default', 'accept-edits', 'full-access'] as const
  const allIn = (mode: (typeof MODES)[number]) =>
    ctx({ mode, writableRoots: mode === 'read-only' || mode === 'plan' ? [] : mode === 'full-access' ? ['/'] : [WS, TMP] })
  const agent = (type: string, isolation?: boolean): PermissionCall => ({
    toolName: 'agent',
    permissionClass: 'agent',
    subject: type,
    ...(isolation ? { isolation } : {}),
  })
  const schedule = (name: string): PermissionCall => ({ toolName: name, permissionClass: 'automation' })

  it('agent：五种模式都放行；带 isolation 时只有 full-access 放行，其余询问', () => {
    expect(MODES.map((mode) => decide(agent('explore'), allIn(mode)).behavior)).toEqual(['allow', 'allow', 'allow', 'allow', 'allow'])
    expect(MODES.map((mode) => decide(agent('general', true), allIn(mode)).behavior)).toEqual(['ask', 'ask', 'ask', 'ask', 'allow'])
    expect(decideWithStep(agent('general', true), allIn('full-access')).step).toBe('mode')
  })

  it('agent：规则组名 Agent，内容为子代理类型；deny 与 ask 规则在任何模式生效', () => {
    expect([canonicalRuleTool('agent'), canonicalRuleTool('AGENT'), canonicalRuleTool('schedule')]).toEqual(['Agent', 'Agent', 'Schedule'])
    expect(decide(agent('explore'), { ...allIn('full-access'), rules: [rule('deny', 'Agent', 'explore')] })).toMatchObject({
      behavior: 'deny',
      rule: { tool: 'Agent', content: 'explore' },
    })
    expect(decide(agent('general'), { ...allIn('full-access'), rules: [rule('deny', 'Agent', 'explore')] }).behavior).toBe('allow')
    expect(decide(agent('general'), { ...allIn('read-only'), rules: [rule('ask', 'Agent')] })).toMatchObject({ behavior: 'ask', reason: 'ask-rule' })
    // 隔离的询问可保存为 Agent 的允许规则。
    expect(decide(agent('general', true), allIn('default'))).toMatchObject({
      behavior: 'ask',
      suggestions: [{ behavior: 'allow', tool: 'Agent', content: 'general' }],
    })
    expect(decide(agent('general', true), { ...allIn('default'), rules: [rule('allow', 'Agent', 'general')] }).behavior).toBe('allow')
  })

  it('automation：只在 full-access 放行；规则组名 Schedule；deny 规则在 full-access 也生效', () => {
    for (const name of ['schedule_create', 'schedule_update'])
      expect(MODES.map((mode) => decide(schedule(name), allIn(mode)).behavior)).toEqual(['ask', 'ask', 'ask', 'ask', 'allow'])
    expect(decide(schedule('schedule_create'), allIn('default'))).toMatchObject({ behavior: 'ask', suggestions: [{ behavior: 'allow', tool: 'Schedule' }] })
    expect(decide(schedule('schedule_create'), { ...allIn('default'), rules: [rule('allow', 'Schedule')] }).behavior).toBe('allow')
    expect(decide(schedule('schedule_update'), { ...allIn('full-access'), rules: [rule('deny', 'Schedule')] }).behavior).toBe('deny')
  })

  it('context-read / session-state 的 M5 工具（agent_wait、schedule_list、agent_cancel、schedule_delete）在五种模式放行', () => {
    for (const [name, permissionClass] of [
      ['agent_wait', 'context-read'],
      ['schedule_list', 'context-read'],
      ['agent_cancel', 'session-state'],
      ['schedule_delete', 'session-state'],
    ] as const)
      expect(MODES.map((mode) => decide({ toolName: name, permissionClass }, allIn(mode)).behavior)).toEqual(['allow', 'allow', 'allow', 'allow', 'allow'])
  })
})

describe('权限类（M6）：lsp 与 team', () => {
  const MODES = ['read-only', 'plan', 'default', 'accept-edits', 'full-access'] as const
  const allIn = (mode: (typeof MODES)[number]) =>
    ctx({ mode, writableRoots: mode === 'read-only' || mode === 'plan' ? [] : mode === 'full-access' ? ['/'] : [WS, TMP] })
  const lsp = (subject: string, resolved: string, real = resolved): PermissionCall => ({
    toolName: 'lsp',
    permissionClass: 'lsp',
    subject,
    target: { resolved, real },
  })
  const asRead = (call: PermissionCall): PermissionCall => ({ ...call, toolName: 'read', permissionClass: undefined })

  it('lsp：file_path 按读取判定（Workspace 内放行、外询问、受保护路径与符号链接与 read 相同），五种模式一致', () => {
    const calls = [
      lsp('src/a.ts', `${WS}/src/a.ts`),
      lsp('/etc/hosts', '/etc/hosts'),
      lsp('.git/config', `${WS}/.git/config`),
      lsp('link/k.ts', `${WS}/link/k.ts`, '/Users/me/.ssh/k.ts'),
    ]
    for (const mode of MODES)
      for (const call of calls) {
        const reasonOf = (d: ReturnType<typeof decide>) => (d.behavior === 'ask' ? d.reason : d.behavior)
        expect(reasonOf(decide(call, allIn(mode)))).toBe(reasonOf(decide(asRead(call), allIn(mode))))
      }
    expect(MODES.map((mode) => decide(calls[0]!, allIn(mode)).behavior)).toEqual(['allow', 'allow', 'allow', 'allow', 'allow'])
    expect(decide(calls[1]!, allIn('default'))).toMatchObject({ behavior: 'ask', suggestions: [{ behavior: 'allow', tool: 'Lsp', content: '/etc/hosts' }] })
    expect(decide(calls[1]!, { ...allIn('default'), readRoots: ['/etc'] }).behavior).toBe('allow')
  })

  it('lsp：规则组名 Lsp；Read 的路径规则同样适用（拒绝、询问、允许）', () => {
    expect(canonicalRuleTool('lsp')).toBe('Lsp')
    const inside = lsp('src/secret.ts', `${WS}/src/secret.ts`)
    expect(decide(inside, { ...allIn('full-access'), rules: [rule('deny', 'Read', 'src/secret.ts')] })).toMatchObject({ behavior: 'deny' })
    expect(decide(inside, { ...allIn('full-access'), rules: [rule('deny', 'Lsp')] })).toMatchObject({ behavior: 'deny' })
    expect(decide(inside, { ...allIn('default'), rules: [rule('ask', 'Read', 'src/**')] })).toMatchObject({ behavior: 'ask', reason: 'ask-rule' })
    const outside = lsp('/opt/lib/x.ts', '/opt/lib/x.ts')
    expect(decide(outside, { ...allIn('default'), rules: [rule('allow', 'Read', '/opt/lib/**')] }).behavior).toBe('allow')
    expect(decide(outside, { ...allIn('default'), rules: [rule('allow', 'Lsp', '/opt/lib/**')] }).behavior).toBe('allow')
    // Read 的规则对 lsp 生效，Lsp 的规则不影响 read。
    expect(decide(asRead(inside), { ...allIn('default'), rules: [rule('deny', 'Lsp')] }).behavior).toBe('allow')
  })

  it('team：send_message 与 task_* 在五种模式放行；规则组名 Team，拒绝规则生效', () => {
    const team = (name: string): PermissionCall => ({ toolName: name, permissionClass: 'team' })
    for (const name of ['send_message', 'task_create', 'task_update', 'task_list'])
      expect(MODES.map((mode) => decide(team(name), allIn(mode)).behavior)).toEqual(['allow', 'allow', 'allow', 'allow', 'allow'])
    expect(canonicalRuleTool('team')).toBe('Team')
    expect(decide(team('send_message'), { ...allIn('full-access'), rules: [rule('deny', 'Team')] })).toMatchObject({
      behavior: 'deny',
      rule: { tool: 'Team' },
    })
    expect(decide(team('task_list'), { ...allIn('read-only'), rules: [rule('ask', 'team')] })).toMatchObject({ behavior: 'ask', reason: 'ask-rule' })
  })

  it('agent 带 name（teammate）与 agent 相同', () => {
    const teammate: PermissionCall = { toolName: 'agent', permissionClass: 'agent', subject: 'general' }
    expect(MODES.map((mode) => decide(teammate, allIn(mode)).behavior)).toEqual(['allow', 'allow', 'allow', 'allow', 'allow'])
    expect(MODES.map((mode) => decide({ ...teammate, isolation: true }, allIn(mode)).behavior)).toEqual(['ask', 'ask', 'ask', 'ask', 'allow'])
  })
})
