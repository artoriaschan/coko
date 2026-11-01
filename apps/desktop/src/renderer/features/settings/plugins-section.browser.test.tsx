// 设置 → 插件分区：列表的五种状态（来源与 commit、贡献计数、诊断）、批准对话框（全部命令、长命令换行不截断、只有"批准"才发 approve、
// 打开期间内容变化时提示）、启用开关与更新（digest 变化回到待批准）、卸载确认、安装（文件夹与 git、失败时行内提示与诊断）、
// 明暗主题下状态文字的对比度与键盘操作。fetch 在测试中替换为内存中的 /api/plugins，目录选择替换 window.coko.pickDirectory。
import '../../styles.css'
import type { PluginInfo } from '@coko/protocol'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { pluginsStore } from '../../stores/plugins-store.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'
import { settingsRegion } from '../../testing/settings-page.ts'

beforeEach(() => pluginsStore.setState({ status: 'idle', plugins: [], error: undefined }))
afterEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.classList.remove('dark')
})

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const digest = (c: string) => c.repeat(64)
const LONG_HOOK = `'/usr/local/bin/node' '/opt/plugins/sample/hooks/guard.mjs' --record '/tmp/${'very-long-segment-'.repeat(10)}stdin.jsonl' --policy strict`

const base = (name: string, overrides: Partial<PluginInfo> = {}): PluginInfo => ({
  name,
  version: '1.0.0',
  source: { kind: 'dir', location: `/src/${name}` },
  status: 'enabled',
  digest: digest('a'),
  approvedDigest: digest('a'),
  contributions: { skills: [], commands: [], agents: [] },
  executables: { hooks: [], mcpServers: [], lspServers: [] },
  diagnostics: [],
  ...overrides,
})

const sample = (overrides: Partial<PluginInfo> = {}) =>
  base('sample', {
    version: '0.1.0',
    description: 'Sample plugin',
    status: 'needs-approval',
    approvedDigest: undefined,
    contributions: { skills: ['sample:greet'], commands: ['sample:hello'], agents: ['sample:reviewer'] },
    executables: {
      hooks: [{ event: 'PreToolUse', matcher: 'Bash', command: LONG_HOOK }],
      mcpServers: [{ name: 'plugin-sample-echo', command: '/usr/local/bin/node', args: ['/opt/mcp/server.ts', '--flag'], envKeys: ['MCP_FIXTURE_LOG'] }],
      lspServers: [{ name: 'sample:ts', command: '/usr/local/bin/node', args: ['/opt/lsp/server.mjs'], extensions: ['.ts'] }],
    },
    ...overrides,
  })

/** 内存中的 /api/plugins；calls 记录每个写请求。 */
function fakePlugins(
  initial: PluginInfo[],
  hooks: { install?: (body: unknown) => Response | PluginInfo; approve?: (name: string, digest: string) => Response | undefined } = {},
) {
  const state = { plugins: new Map(initial.map((p) => [p.name, p])), calls: [] as [string, string, unknown][] }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body))
      if (!input.startsWith('/api/plugins')) return json(404, { error: { code: 'not-found', message: 'not found' } })
      if (method === 'GET') return json(200, [...state.plugins.values()])
      state.calls.push([method, input, body])
      const name = decodeURIComponent(input.split('/')[3] ?? '')
      const current = state.plugins.get(name)
      if (method === 'POST' && input === '/api/plugins') {
        const reply = hooks.install?.(body) ?? sample()
        if (reply instanceof Response) return reply
        state.plugins.set(reply.name, reply)
        return json(201, reply)
      }
      if (!current) return json(404, { error: { code: 'plugin-not-found', message: 'missing' } })
      if (input.endsWith('/approve')) {
        const reply = hooks.approve?.(name, body.digest)
        if (reply) return reply
        const current = state.plugins.get(name)!
        if (body.digest !== current.digest) return json(409, { error: { code: 'digest-mismatch', message: 'changed', details: { digest: current.digest } } })
        const next = { ...current, status: 'enabled' as const, approvedDigest: current.digest }
        state.plugins.set(name, next)
        return json(200, next)
      }
      if (input.endsWith('/update')) {
        const next = { ...current, status: 'needs-approval' as const, digest: digest('u') }
        state.plugins.set(name, next)
        return json(200, next)
      }
      if (method === 'PATCH') {
        const next = { ...current, status: body.enabled ? ('enabled' as const) : ('disabled' as const) }
        state.plugins.set(name, next)
        return json(200, next)
      }
      if (method === 'DELETE') {
        state.plugins.delete(name)
        return new Response(null, { status: 204 })
      }
      return json(404, { error: { code: 'not-found', message: 'x' } })
    }),
  )
  return state
}

async function open(theme: 'light' | 'dark' = 'light') {
  const store = createAppearanceStore({ theme, locale: 'en' })
  const { chat, settings } = createFixtureChat()
  const settingsPage = createSettingsPageStore()
  const preferences = createPreferences({ appearance: store, settings, onConflict: () => {}, onFailure: () => {} })
  const screen = await render(
    <div style={{ width: '100vw', height: '100vh' }}>
      <App
        store={store}
        connection={createConnectionStore()}
        chat={chat}
        settings={settings}
        preferences={preferences}
        settingsPage={settingsPage}
        pickDirectory={async () => null}
      />
    </div>,
  )
  settingsPage.open('plugins')
  const region = settingsRegion()
  await expect.element(region.getByRole('heading', { name: 'Plugins', level: 2 })).toBeVisible()
  return { screen, region }
}

const card = (name: string) => document.querySelector<HTMLElement>(`[data-plugin="${name}"]`)
const approvalDialog = () => page.getByRole('dialog', { name: /^Approve plugin / })
/** 等对话框关闭且 body 的 pointer-events 复原（Radix 关闭动画之后）。 */
const closed = async () => {
  await expect.poll(() => document.querySelector('[data-slot="dialog-content"]')).toBeNull()
  await expect.poll(() => document.body.style.pointerEvents).toBe('')
}

for (const theme of ['light', 'dark'] as const) {
  it(`列表：五种状态、来源与 commit、贡献计数、诊断；状态文字对比度（${theme}）`, async () => {
    fakePlugins([
      sample(),
      base('alpha'),
      base('beta', { status: 'disabled', source: { kind: 'git', location: 'https://example.com/beta.git', ref: 'v2', commit: 'abcdef0123456789' } }),
      base('gamma', { status: 'incompatible', diagnostics: [{ source: 'plugin', code: 'incompatible-engine', message: 'requires coko >=9.0.0' }] }),
      base('delta', {
        status: 'invalid',
        diagnostics: [{ source: 'plugin', code: 'path-outside-plugin', path: 'skills', message: 'skills resolves outside the plugin root' }],
      }),
    ])
    const { screen } = await open(theme)
    await expect
      .poll(() => [...document.querySelectorAll('[data-plugin]')].map((el) => [el.getAttribute('data-plugin'), el.getAttribute('data-status')]))
      .toEqual([
        ['sample', 'needs-approval'],
        ['alpha', 'enabled'],
        ['beta', 'disabled'],
        ['gamma', 'incompatible'],
        ['delta', 'invalid'],
      ])
    const status = (name: string) => card(name)!.querySelector('[data-plugin-status]')!
    expect(['sample', 'alpha', 'beta', 'gamma', 'delta'].map((n) => status(n).textContent)).toEqual([
      'Needs approval',
      'Enabled',
      'Disabled',
      'Incompatible',
      'Invalid',
    ])
    for (const name of ['sample', 'alpha', 'beta', 'gamma', 'delta']) expect(contrastOf(status(name))).toBeGreaterThanOrEqual(4.5)
    // 不兼容与无效另有破坏性颜色的图标（非文字元素，对比度不低于 3:1）。
    for (const name of ['gamma', 'delta']) expect(contrastOf(card(name)!.querySelector('[data-plugin-status] svg')!)).toBeGreaterThanOrEqual(3)
    expect(card('alpha')!.querySelector('[data-plugin-status] svg')).toBeNull()

    // 版本、来源、commit 与贡献计数。
    expect(card('sample')!.querySelector('[data-plugin-version]')!.textContent).toBe('0.1.0')
    expect(card('sample')!.querySelector('[data-plugin-counts]')!.textContent).toBe(
      '1 skill(s) · 1 command(s) · 1 agent(s) · 1 hook(s) · 1 MCP server(s) · 1 language server(s)',
    )
    expect(card('beta')!.querySelector('[data-plugin-source]')!.textContent).toBe('git · https://example.com/beta.git · ref v2 · commit abcdef0')
    expect(card('beta')!.querySelector('[data-plugin-commit]')!.getAttribute('title')).toBe('abcdef0123456789')

    // 诊断：按 code 本地化标题，原文作为细节。
    const diagnostic = (name: string) => card(name)!.querySelector('[data-diagnostic]')!
    expect(diagnostic('gamma').textContent).toBe('The required Coko version is not metrequires coko >=9.0.0')
    expect(diagnostic('delta').getAttribute('data-diagnostic')).toBe('path-outside-plugin')
    expect(diagnostic('delta').textContent).toContain('skills: skills resolves outside the plugin root')

    // 操作随状态：待批准有"查看并批准"、无开关；启用 / 停用有开关；不兼容与无效没有开关与批准。
    const has = (name: string, action: string) => card(name)!.querySelector(`[data-action="${action}"]`) !== null
    expect(['sample', 'alpha', 'beta', 'gamma', 'delta'].map((n) => [has(n, 'review'), has(n, 'toggle')])).toEqual([
      [true, false],
      [false, true],
      [false, true],
      [false, false],
      [false, false],
    ])
    expect(card('alpha')!.querySelector('[data-action="toggle"]')!.getAttribute('aria-checked')).toBe('true')
    expect(card('beta')!.querySelector('[data-action="toggle"]')!.getAttribute('aria-checked')).toBe('false')
    await screen.unmount()
  })
}

it('批准对话框：显示全部命令（长命令换行、不截断）；取消与 Esc 不发 approve；Tab 到"批准"后按 Enter 才发 approve', async () => {
  const state = fakePlugins([sample()])
  const { screen } = await open()
  await expect.poll(() => card('sample')?.getAttribute('data-status')).toBe('needs-approval')
  const review = card('sample')!.querySelector<HTMLButtonElement>('[data-action="review"]')!

  // 取消：不发请求。
  review.click()
  const dialog = approvalDialog()
  await expect.element(dialog).toBeVisible()
  const content = dialog.element()
  const command = content.querySelector('[data-approval-hook="0"] [data-approval-command]')!
  expect(command.textContent).toBe(LONG_HOOK)
  expect(command.scrollWidth).toBeLessThanOrEqual(command.clientWidth + 1)
  // 命令在对话框内完整可见：没有被裁剪（对话框不超出窗口宽度，命令不超出对话框）。
  expect(command.getBoundingClientRect().right).toBeLessThanOrEqual(content.getBoundingClientRect().right)
  expect(content.querySelector('[data-approval-hook="0"]')!.textContent).toContain('Event: PreToolUse')
  expect(content.querySelector('[data-approval-hook="0"]')!.textContent).toContain('Matcher: Bash')
  const mcp = content.querySelector('[data-approval-mcp="plugin-sample-echo"]')!.textContent
  for (const part of ['/usr/local/bin/node', '/opt/mcp/server.ts\n--flag', 'MCP_FIXTURE_LOG']) expect(mcp).toContain(part)
  expect(content.querySelector('[data-approval-lsp="sample:ts"]')!.textContent).toContain('/opt/lsp/server.mjs')
  expect(content.querySelector('[data-approval-lsp="sample:ts"]')!.textContent).toContain('.ts')
  expect(['skills', 'commands', 'agents'].map((k) => content.querySelector(`[data-approval-names="${k}"] p`)!.textContent)).toEqual([
    'sample:greet',
    'sample:hello',
    'sample:reviewer',
  ])
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await closed()
  expect(state.calls).toEqual([])

  // Esc 关闭：不发请求。
  review.click()
  await expect.element(approvalDialog()).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await closed()
  expect(state.calls).toEqual([])

  // 键盘：Tab 到"批准"（焦点环可见），Enter 后发 approve（带所显示内容的 digest），状态变为已启用。
  review.click()
  await expect.element(approvalDialog()).toBeVisible()
  const approve = approvalDialog().getByRole('button', { name: 'Approve' }).element() as HTMLButtonElement
  for (let i = 0; i < 6 && document.activeElement !== approve; i++) await userEvent.keyboard('{Tab}')
  expect(document.activeElement).toBe(approve)
  expect(approve.matches(':focus-visible')).toBe(true)
  expect(state.calls).toEqual([])
  await userEvent.keyboard('{Enter}')
  await closed()
  expect(state.calls).toEqual([['POST', '/api/plugins/sample/approve', { digest: digest('a') }]])
  await expect.poll(() => card('sample')?.getAttribute('data-status')).toBe('enabled')
  await screen.unmount()
})

it('批准时内容已变化（409 digest-mismatch）：对话框不关闭，提示已变化并显示最新命令；再批准用新的 digest', async () => {
  const state = fakePlugins([sample()], {
    approve: (name, sent) => {
      if (sent === digest('a')) {
        // 来源被更新：Hook 命令与 digest 都变了。
        state.plugins.set(name, sample({ digest: digest('b'), executables: { ...sample().executables, hooks: [{ event: 'Stop', command: 'changed.sh' }] } }))
      }
      return undefined
    },
  })
  const { screen } = await open()
  await expect.poll(() => card('sample')?.getAttribute('data-status')).toBe('needs-approval')
  card('sample')!.querySelector<HTMLButtonElement>('[data-action="review"]')!.click()
  const dialog = approvalDialog()
  await expect.element(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Approve' }).click()
  await expect.element(dialog.getByRole('alert')).toHaveTextContent('The plugin changed; the latest content is shown below, review it again')
  await expect.poll(() => dialog.element().querySelector('[data-approval-hook="0"] [data-approval-command]')?.textContent).toBe('changed.sh')
  await dialog.getByRole('button', { name: 'Approve' }).click()
  await closed()
  expect(state.calls.map((c) => c[2])).toEqual([{ digest: digest('a') }, { digest: digest('b') }])
  await expect.poll(() => card('sample')?.getAttribute('data-status')).toBe('enabled')
  await screen.unmount()
})

it('启用开关发 PATCH；更新后 digest 变化回到待批准并提示；卸载经确认框，取消不删除，确认后列表为空', async () => {
  const state = fakePlugins([base('alpha')])
  const { screen } = await open()
  await expect.poll(() => card('alpha')?.getAttribute('data-status')).toBe('enabled')
  card('alpha')!.querySelector<HTMLButtonElement>('[data-action="toggle"]')!.click()
  await expect.poll(() => card('alpha')?.getAttribute('data-status')).toBe('disabled')
  expect(state.calls).toEqual([['PATCH', '/api/plugins/alpha', { enabled: false }]])

  card('alpha')!.querySelector<HTMLButtonElement>('[data-action="update"]')!.click()
  await expect.poll(() => card('alpha')?.getAttribute('data-status')).toBe('needs-approval')
  await expect.element(page.getByText('What alpha runs has changed; it loads again after you approve it')).toBeVisible()
  expect(card('alpha')!.querySelector('[data-action="review"]')).not.toBeNull()

  // 卸载：取消不发 DELETE。
  card('alpha')!.querySelector<HTMLButtonElement>('[data-action="uninstall"]')!.click()
  const confirm = page.getByRole('alertdialog', { name: 'Uninstall alpha?' })
  await expect.element(confirm).toBeVisible()
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await closed()
  expect(state.calls.filter((c) => c[0] === 'DELETE')).toEqual([])
  expect(card('alpha')).not.toBeNull()

  card('alpha')!.querySelector<HTMLButtonElement>('[data-action="uninstall"]')!.click()
  await expect.element(confirm).toBeVisible()
  await confirm.getByRole('button', { name: 'Uninstall' }).click()
  await closed()
  expect(state.calls.filter((c) => c[0] === 'DELETE')).toEqual([['DELETE', '/api/plugins/alpha', undefined]])
  await expect.poll(() => document.querySelector('[data-plugins-empty]')?.textContent).toBe('No plugins installed yet')
  expect(card('alpha')).toBeNull()
  await screen.unmount()
})

it('安装：从文件夹（目录选择）安装后打开批准对话框；git 地址与 ref；清单无效时行内显示诊断；不合规的错误体显示通用提示与技术详情', async () => {
  let reply: Response | PluginInfo = sample()
  const state = fakePlugins([], { install: () => reply })
  vi.stubGlobal('coko', { pickDirectory: async () => '/Users/me/plugins/sample' })
  const { screen, region } = await open()
  await expect.poll(() => document.querySelector('[data-plugins-empty]')).not.toBeNull()

  await region.getByRole('button', { name: 'Install from folder…' }).click()
  await expect.element(approvalDialog()).toBeVisible()
  expect(state.calls).toEqual([['POST', '/api/plugins', { source: { kind: 'dir', path: '/Users/me/plugins/sample' } }]])
  await approvalDialog().getByRole('button', { name: 'Cancel' }).click()
  await closed()
  expect(card('sample')?.getAttribute('data-status')).toBe('needs-approval')

  // git 地址为空：提示，不发请求。
  const submit = region.getByRole('button', { name: 'Install from git' })
  await submit.click()
  await expect.element(region.getByRole('alert')).toHaveTextContent('Enter a git URL')
  expect(state.calls).toHaveLength(1)

  // 清单无效：诊断行内显示。
  reply = json(400, {
    error: {
      code: 'plugin-invalid',
      message: 'invalid',
      details: { diagnostics: [{ source: 'plugin', code: 'invalid-name', message: 'name "Bad" is not valid' }] },
    },
  })
  await region.getByRole('textbox', { name: 'git URL' }).fill('https://example.com/bad.git')
  await region.getByRole('textbox', { name: 'Branch or tag (optional)' }).fill('v1')
  await submit.click()
  const problem = () => document.querySelector('[data-install-problem]')
  await expect.poll(() => problem()?.querySelector('p')?.textContent).toBe('The plugin manifest has problems; nothing was installed')
  expect(problem()!.querySelector('[data-diagnostic="invalid-name"]')!.textContent).toBe('The plugin name is not validname "Bad" is not valid')
  expect(state.calls.at(-1)).toEqual(['POST', '/api/plugins', { source: { kind: 'git', url: 'https://example.com/bad.git', ref: 'v1' } }])
  // 失败保留输入。
  await expect.element(region.getByRole('textbox', { name: 'git URL' })).toHaveValue('https://example.com/bad.git')

  // 错误体不符合 ErrorResponse：不信任其中的 code，显示通用提示，原文放在技术详情中。
  reply = new Response(JSON.stringify({ error: { code: 'plugin-exists' } }), { status: 409 })
  await submit.click()
  await expect.poll(() => problem()?.querySelector('p')?.textContent).toBe('The action failed; try again later')
  expect(problem()!.querySelector('[data-error-detail]')!.textContent).toContain('Request failed with status 409')
  await screen.unmount()
})

const rgb = (value: string) =>
  value
    .match(/[\d.]+/g)!
    .slice(0, 3)
    .map(Number) as [number, number, number]
const luminance = ([r, g, b]: [number, number, number]) => {
  const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const transparent = (color: string) => color === 'transparent' || /rgba\(.*,\s*0\)$/.test(color)
function contrastOf(el: Element): number {
  let node: Element | null = el
  let background = ''
  while (node) {
    const color = getComputedStyle(node).backgroundColor
    if (!transparent(color)) {
      background = color
      break
    }
    node = node.parentElement
  }
  if (background === '') background = getComputedStyle(document.documentElement).backgroundColor
  const [x, y] = [luminance(rgb(getComputedStyle(el).color)), luminance(rgb(background))].sort((p, q) => q - p)
  return (x! + 0.05) / (y! + 0.05)
}
