import { describe, expect, it } from 'vitest'
import type { PermissionRule } from '../session-entries/index.ts'
import { canonicalRuleTool, decide, type PermissionCall, type PermissionContext } from './decide.ts'

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
  const roots: Record<PermissionContext['mode'], string[]> = { 'read-only': [], default: [WS, TMP], 'accept-edits': [WS, TMP], 'full-access': ['/'] }
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

  it('内置工具名不受宿主给出的权限类影响', () => {
    expect(decide(call('bash', 'context-read'), ctx()).behavior).toBe('ask')
    expect(decide({ ...file('write', 'a', `${WS}/a`), permissionClass: 'context-read' }, ctx()).behavior).toBe('ask')
  })
})
