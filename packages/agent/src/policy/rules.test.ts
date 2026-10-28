// 规则语法与匹配（grilling A4），经 decide() 观察：bash 精确 / 前缀、复合命令拆分、命令替换与子命令上限、env 前缀剥离，
// read / edit 组的 gitignore 风格路径（Workspace 相对、绝对、~/）。
import { describe, expect, it } from 'vitest'
import type { PermissionRule } from '../session-entries/index.ts'
import { decide, type PermissionCall, type PermissionContext } from './decide.ts'

const WS = '/ws/project'
const HOME = '/Users/me'

const ctx = (rules: PermissionRule[], overrides: Partial<PermissionContext> = {}): PermissionContext => ({
  mode: 'default',
  rules,
  workspace: WS,
  writableRoots: [WS, '/private/tmp'],
  home: HOME,
  ...overrides,
})
const rule = (behavior: PermissionRule['behavior'], tool: string, content?: string): PermissionRule => ({
  behavior,
  tool,
  ...(content === undefined ? {} : { content }),
})
const bash = (command: string): PermissionCall => ({ toolName: 'bash', subject: command })
const file = (toolName: string, subject: string, resolved: string, real = resolved): PermissionCall => ({ toolName, subject, target: { resolved, real } })
const behavior = (call: PermissionCall, context: PermissionContext) => decide(call, context).behavior

describe('bash 规则', () => {
  it.each<[string, string, string, 'allow' | 'ask']>([
    ['精确匹配', 'npm test', 'npm test', 'allow'],
    ['精确规则不匹配多出的参数', 'npm test', 'npm test --watch', 'ask'],
    ['多余空白不影响匹配', 'npm test', '  npm   test ', 'allow'],
    ['尾随 " *" 为前缀', 'git *', 'git status', 'allow'],
    ['前缀规则匹配裸命令', 'git *', 'git', 'allow'],
    ['前缀按词边界', 'git *', 'gitk --all', 'ask'],
    ['复合命令的子命令全部允许才允许', 'git *', 'git status && git diff; git log || git show', 'allow'],
    ['复合命令中有未允许的子命令时询问', 'git *', 'git status && npm test', 'ask'],
    ['管道也拆分', 'git *', 'git log | head -5', 'ask'],
    ['引号内的分隔符不拆分', 'echo *', 'echo \'a && b\' "c | d"', 'allow'],
    ['安全的 env 前缀被剥离', 'npm test', 'FOO=1 BAR="x y" npm test', 'allow'],
    ['LD_* 前缀不剥离', 'npm test', 'LD_PRELOAD=/tmp/x.so npm test', 'ask'],
    ['DYLD_* 前缀不剥离', 'npm test', 'DYLD_INSERT_LIBRARIES=/tmp/x.dylib npm test', 'ask'],
    ['PATH 前缀不剥离', 'npm test', 'PATH=/tmp/evil npm test', 'ask'],
    ['$(…) 命令替换询问', 'echo *', 'echo $(whoami)', 'ask'],
    ['反引号命令替换询问', 'echo *', 'echo `whoami`', 'ask'],
    ['双引号内的命令替换仍询问', 'echo *', 'echo "$(whoami)"', 'ask'],
    ['单引号内的 $( 只是文本', 'echo *', "echo '$(whoami)'", 'allow'],
    ['进程替换询问', 'cat *', 'cat <(ls)', 'ask'],
    ['子 shell 询问', 'git *', '(git status)', 'ask'],
  ])('%s：Bash(%s) 对 %s → %s', (_name, content, command, expected) => {
    expect(behavior(bash(command), ctx([rule('allow', 'Bash', content)]))).toBe(expected)
  })

  it('子命令超过 50 个时询问，恰好 50 个仍按规则允许', () => {
    const rules = [rule('allow', 'Bash', 'true')]
    expect(behavior(bash(Array(50).fill('true').join(' && ')), ctx(rules))).toBe('allow')
    expect(behavior(bash(Array(51).fill('true').join(' && ')), ctx(rules))).toBe('ask')
  })

  it('不带内容的 Bash 规则匹配任何命令，包括命令替换', () => {
    expect(behavior(bash('echo $(date) && make'), ctx([rule('allow', 'Bash')]))).toBe('allow')
  })

  it.each<[string, string]>([
    ['拆分后任一子命令命中拒绝规则', 'git status && rm -rf x'],
    ['剥掉 env 前缀后命中', 'FOO=1 rm -rf x'],
    ['命令替换中的子命令也检查拒绝规则', 'echo $(rm -rf x)'],
    ['分号后命中', 'ls; rm -rf /'],
  ])('%s：%s → deny', (_name, command) => {
    const rules = [rule('allow', 'Bash', 'git *'), rule('allow', 'Bash', 'echo *'), rule('deny', 'Bash', 'rm *')]
    expect(decide(bash(command), ctx(rules))).toEqual({ behavior: 'deny', rule: rule('deny', 'Bash', 'rm *') })
  })

  it('询问规则命中任一子命令即询问（即使其余被允许）', () => {
    const rules = [rule('allow', 'Bash', 'git *'), rule('ask', 'Bash', 'git push *')]
    expect(decide(bash('git add . && git push origin main'), ctx(rules))).toMatchObject({ behavior: 'ask', reason: 'ask-rule' })
  })

  it('建议规则：每个尚未允许的子命令（剥掉安全 env 前缀）；含命令替换时没有建议', () => {
    const suggestions = (command: string, rules: PermissionRule[] = []) => {
      const decision = decide(bash(command), ctx(rules))
      return decision.behavior === 'ask' ? decision.suggestions : undefined
    }
    expect(suggestions('npm test')).toEqual([rule('allow', 'Bash', 'npm test')])
    expect(suggestions('FOO=1 npm test')).toEqual([rule('allow', 'Bash', 'npm test')])
    expect(suggestions('git status && npm test', [rule('allow', 'Bash', 'git *')])).toEqual([rule('allow', 'Bash', 'npm test')])
    expect(suggestions('make && make')).toEqual([rule('allow', 'Bash', 'make')])
    expect(suggestions('echo $(date)')).toEqual([])
  })
})

describe('路径规则（gitignore 风格）', () => {
  it.each<[string, PermissionRule, PermissionCall, 'allow' | 'ask']>([
    ['Edit(src/**) 允许 src 下的写入', rule('allow', 'Edit', 'src/**'), file('write', 'src/a/b.ts', `${WS}/src/a/b.ts`), 'allow'],
    ['Edit(src/**) 不允许 src 之外', rule('allow', 'Edit', 'src/**'), file('edit', 'lib/a.ts', `${WS}/lib/a.ts`), 'ask'],
    ['Edit(src/**) 不匹配 Workspace 外同名目录', rule('allow', 'Edit', 'src/**'), file('write', '/private/tmp/src/a.ts', '/private/tmp/src/a.ts'), 'ask'],
    ['没有斜杠的模式匹配任意深度', rule('allow', 'Edit', '*.md'), file('write', 'docs/guide/a.md', `${WS}/docs/guide/a.md`), 'allow'],
    ['./ 开头锚定在 Workspace 根', rule('allow', 'Edit', './a.md'), file('write', 'docs/a.md', `${WS}/docs/a.md`), 'ask'],
    ['目录模式覆盖其下文件', rule('allow', 'Edit', 'notes'), file('write', 'notes/x/y.txt', `${WS}/notes/x/y.txt`), 'allow'],
    ['Read(~/x) 允许主目录下的 x', rule('allow', 'Read', '~/x'), file('read', '~/x', `${HOME}/x`), 'allow'],
    ['Read(~/x) 覆盖 x 之下', rule('allow', 'Read', '~/x'), file('ls', '~/x/y', `${HOME}/x/y`), 'allow'],
    ['Read(~/x) 不匹配其他位置的 x', rule('allow', 'Read', '~/x'), file('read', '/other/x', '/other/x'), 'ask'],
    ['绝对路径模式', rule('allow', 'Read', '/etc/**'), file('read', '/etc/hosts', '/etc/hosts'), 'allow'],
    ['绝对路径模式不匹配兄弟目录', rule('allow', 'Read', '/etc/**'), file('read', '/etcetera/x', '/etcetera/x'), 'ask'],
    ['按真实路径匹配：Workspace 内指向外部的链接', rule('allow', 'Read', '/data/**'), file('read', 'link/k', `${WS}/link/k`, '/data/k'), 'allow'],
  ])('%s', (_name, saved, call, expected) => {
    expect(behavior(call, ctx([saved]))).toBe(expected)
  })

  it('拒绝规则按 gitignore 匹配并对大小写变体生效', () => {
    const rules = [rule('deny', 'Read', '.env'), rule('deny', 'Edit', 'secrets/**')]
    expect(behavior(file('read', 'app/.env', `${WS}/app/.env`), ctx(rules))).toBe('deny')
    expect(behavior(file('write', 'Secrets/k', `${WS}/Secrets/k`), ctx(rules))).toBe('deny')
    expect(behavior(file('read', 'src/a.ts', `${WS}/src/a.ts`), ctx(rules))).toBe('allow')
  })

  it('Workspace 根本身只匹配 . 与不带内容的规则', () => {
    expect(behavior(file('ls', '.', WS), ctx([rule('deny', 'Read', '.')]))).toBe('deny')
    expect(behavior(file('ls', '.', WS), ctx([rule('deny', 'Read', 'src/**')]))).toBe('allow')
    expect(behavior(file('ls', '.', WS), ctx([rule('deny', 'Read')]))).toBe('deny')
  })
})
