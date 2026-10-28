import { describe, expect, it } from 'vitest'
import type { PermissionRule } from '../session-entries/index.ts'
import { decide, type PermissionCall, type PermissionContext } from './decide.ts'

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
