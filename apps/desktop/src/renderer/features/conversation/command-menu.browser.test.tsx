import '../../styles.css'
import type { CommandInfo } from '@coko/protocol'
import { ComposerEditor } from '@coko/ui'
import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { I18nProvider } from '../../app/i18n.tsx'
import { createCommandsStore } from '../../stores/commands-store.ts'
import { CommandMenu } from './command-menu.tsx'

const info = (name: string, source: CommandInfo['source'], extra: Partial<CommandInfo> = {}): CommandInfo => ({
  name,
  description: '',
  source,
  enabled: true,
  ...extra,
})

/** 目录顺序（来源、再按名字）：插件的命令在用户来源中、插件的 Skill 在 Skill 来源中。 */
const BASE: CommandInfo[] = [info('compact', 'builtin'), info('review', 'project'), info('hello', 'user'), info('greet', 'skill'), info('docs:search', 'mcp')]
const WITH_PLUGINS: CommandInfo[] = [
  info('compact', 'builtin'),
  info('review', 'project'),
  info('hello', 'user'),
  info('sample:hello', 'user', { plugin: 'sample' }),
  info('zeta:usage', 'user', { plugin: 'zeta' }),
  info('greet', 'skill'),
  info('alpha:sampler', 'skill', { plugin: 'alpha' }),
  info('sample:greet', 'skill', { plugin: 'sample' }),
  info('docs:search', 'mcp'),
]

async function setup(commands: CommandInfo[], locale: 'en' | 'zh' = 'en') {
  const store = createCommandsStore(async () => ({ commands, diagnostics: [] }))
  await render(
    <I18nProvider locale={locale}>
      <div style={{ width: 480, padding: '420px 16px 16px' }}>
        <ComposerEditor label="Task" placeholder="Give Coko a task" onSubmit={() => true}>
          <CommandMenu target={{ workspaceId: 'ws-1' }} store={store} />
        </ComposerEditor>
      </div>
    </I18nProvider>,
  )
  await expect.poll(() => store.getState().status).toBe('ready')
}

const editor = () => page.getByRole('textbox', { name: 'Task' })
const groupEls = () => [...document.querySelectorAll<HTMLElement>('[role="listbox"] [role="group"]')]
/** 每个分组：[id, 组名, 条目标签…]，按显示顺序。 */
const groups = () =>
  groupEls().map((g) => [
    g.getAttribute('data-group'),
    document.getElementById(g.getAttribute('aria-labelledby')!)!.textContent,
    ...[...g.querySelectorAll('[role="option"]')].map((o) => o.textContent),
  ])
const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')]
const selected = () => options().findIndex((o) => o.getAttribute('aria-selected') === 'true')

async function open(query = '') {
  await editor().click()
  await userEvent.keyboard('/' + query)
  await expect.poll(() => options().length).toBeGreaterThan(0)
}
async function close() {
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => options().length).toBe(0)
}

describe('CommandMenu：插件分组', () => {
  it('插件贡献的命令与 Skill 归入“插件”组，位于 Skill 之后、MCP 之前，组内按名字；用户与 Skill 组不含插件条目；↓ 按显示顺序移动', async () => {
    await setup(WITH_PLUGINS)
    await open()
    expect(groups()).toEqual([
      ['builtin', 'Built-in', '/compact'],
      ['project', 'Project', '/review'],
      ['user', 'User', '/hello'],
      ['skill', 'Skill', '/greet'],
      ['plugin', 'Plugin', '/alpha:sampler', '/sample:greet', '/sample:hello', '/zeta:usage'],
      ['mcp', 'MCP', '/docs:search'],
    ])
    const visited = [selected()]
    for (let i = 1; i < options().length; i++) {
      await userEvent.keyboard('{ArrowDown}')
      visited.push(selected())
    }
    expect(visited).toEqual(options().map((_, index) => index))
    await close()
  })

  it('组内前缀匹配在前、包含匹配在后', async () => {
    await setup(WITH_PLUGINS)
    await open('sa')
    expect(groups()).toEqual([['plugin', 'Plugin', '/sample:greet', '/sample:hello', '/alpha:sampler', '/zeta:usage']])
    await close()
  })

  it('没有带插件名的可用条目时没有“插件”组：没有插件，或插件的命令已停用', async () => {
    await setup([...BASE, info('sample:hello', 'user', { plugin: 'sample', enabled: false })])
    await open()
    expect(groups().map((g) => g[0])).toEqual(['builtin', 'project', 'user', 'skill', 'mcp'])
    expect(options().map((o) => o.textContent)).not.toContainEqual(expect.stringContaining('sample'))
    await close()
  })

  it('中文组名为“插件”', async () => {
    await setup(WITH_PLUGINS, 'zh')
    await open('sample:h')
    expect(groups()).toEqual([['plugin', '插件', '/sample:hello']])
    await close()
  })
})
