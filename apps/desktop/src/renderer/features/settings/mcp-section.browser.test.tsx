// MCP 分区的错误文案（ui.md：错误用本地化的用户语言，技术详情放入诊断入口）：保存被服务端拒绝时显示本地化文案，服务端原文只在
// 可展开的技术详情中；删除 Secret 失败时 toast 只有本地化文案。fetch 在测试中替换（mcpStore 每次调用时取全局 fetch）。
import '../../styles.css'
import { afterEach, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'
import { settingsRegion } from '../../testing/settings-page.ts'

const RAW = 'server "x" conflicts with "X" (names differ only in case, "-" or "_")'
const RAW_DELETE = 'SQLITE_BUSY: database is locked'

afterEach(() => {
  vi.unstubAllGlobals()
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
/** 文字颜色对其最近的不透明背景（向上找祖先，最后是根元素）的对比度。 */
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

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

for (const theme of ['light', 'dark'] as const) {
  it(`作文字的警告色对比度 ≥ 4.5:1（${theme}）：待批准状态与"MCP 已关闭"提示`, async () => {
    const server = { name: 'proj', scope: 'project', transport: 'stdio', enabled: true, status: 'pending-approval', tools: [] }
    const mcp = { enabled: false, servers: [server], global: {}, globalRevision: 0, diagnostics: [] }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input.startsWith('/api/mcp')) return json(200, mcp)
        if (input.startsWith('/api/secrets')) return json(200, { source: 'stored', secrets: [] })
        return json(404, { error: { code: 'not-found', message: 'not found' } })
      }),
    )
    const store = createAppearanceStore({ theme, locale: 'en' })
    const { chat, settings } = createFixtureChat()
    const settingsPage = createSettingsPageStore()
    const preferences = createPreferences({ appearance: store, settings, onConflict: () => {}, onFailure: () => {} })
    await render(
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
    settingsPage.open('mcp')
    const dialog = settingsRegion()
    await expect.element(dialog.getByText('Awaiting approval')).toBeVisible()
    const status = dialog.element().querySelector('[data-mcp-server="proj"] [data-mcp-status]')!
    const disabled = [...dialog.element().querySelectorAll('p')].find(
      (p) => p.textContent === 'MCP is turned off in the capability settings; servers will not connect',
    )!
    expect([contrastOf(status) >= 4.5, contrastOf(disabled) >= 4.5]).toEqual([true, true])
  })
}

it('保存被拒绝与删除 Secret 失败：界面只显示本地化文案，服务端原文在技术详情中', async () => {
  const mcp = { enabled: true, servers: [], global: {}, globalRevision: 0, diagnostics: [] }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (input.startsWith('/api/mcp/servers') && method === 'PUT') return json(400, { error: { code: 'bad-request', message: RAW } })
      if (input.startsWith('/api/mcp')) return json(200, mcp)
      if (input.startsWith('/api/secrets/') && method === 'DELETE') return json(500, { error: { code: 'internal', message: RAW_DELETE } })
      if (input.startsWith('/api/secrets')) return json(200, { source: 'stored', secrets: [{ name: 'MY_SERVICE_DSN', hint: '9f3c' }] })
      if (input.startsWith('/api/config'))
        return json(200, {
          effective: {
            instructions: { enabled: true },
            skills: { enabled: true, disabled: [] },
            commands: { enabled: true, disabled: [] },
            mcp: { enabled: true },
            memory: { enabled: true },
            context: { autoCompact: true, trimOldToolResults: true },
          },
          global: {},
          globalRevision: 0,
        })
      return json(404, { error: { code: 'not-found', message: 'not found' } })
    }),
  )
  const store = createAppearanceStore({ theme: 'light', locale: 'en' })
  const { chat, settings } = createFixtureChat()
  const settingsPage = createSettingsPageStore()
  const preferences = createPreferences({ appearance: store, settings, onConflict: () => {}, onFailure: () => {} })
  await render(
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
  settingsPage.open('mcp')
  const dialog = settingsRegion()
  await dialog.getByRole('button', { name: 'Add server' }).click()
  const form = dialog.element().querySelector('[data-mcp-form]') as HTMLElement
  await page.elementLocator(form).getByLabelText('Name', { exact: true }).fill('X')
  await page.elementLocator(form).getByLabelText('Command', { exact: true }).fill('node')
  await page.elementLocator(form).getByRole('button', { name: 'Save', exact: true }).click()
  const alert = dialog.getByRole('alert')
  await expect.element(alert).toHaveTextContent("Couldn't save MCP settings")
  expect(alert.element().textContent).not.toContain(RAW)
  const detail = dialog.element().querySelector('[data-error-detail]') as HTMLDetailsElement
  expect(detail.textContent).toContain(RAW)
  expect(detail.open).toBe(false)

  await dialog.element().querySelector<HTMLButtonElement>('[data-secret="MY_SERVICE_DSN"] button')!.click()
  await expect.element(page.getByText("Couldn't delete secret MY_SERVICE_DSN; try again later")).toBeVisible()
  expect(document.body.textContent).not.toContain(RAW_DELETE)
})

// 认证与浏览器预设（docs/subsystems/mcp.md#界面）：auth-required 的徽标（明暗主题对比度）、说明与"编辑请求头"（打开表单并聚焦 headers）、
// 本地化的诊断；"添加浏览器"菜单从 /api/mcp/presets 读取，确认后经全局保存接口写入，名字冲突时提示改名（键盘完成）。
const PRESET = {
  id: 'playwright',
  name: 'playwright',
  label: 'Browser (Playwright)',
  config: { command: 'npx', args: ['-y', '@playwright/mcp@0.0.83', '--isolated'] },
}

async function mountMcp(mcp: Record<string, unknown>, theme: 'light' | 'dark' = 'light', locale: 'en' | 'zh' = 'en') {
  const puts: { servers: Record<string, unknown> }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (input.startsWith('/api/mcp/presets')) return json(200, { presets: [PRESET] })
      if (input.startsWith('/api/mcp/servers') && method === 'PUT') {
        const body = JSON.parse(String(init!.body)) as { servers: Record<string, unknown> }
        puts.push(body)
        Object.assign(mcp, { global: body.servers, globalRevision: 1 })
        return json(200, mcp)
      }
      if (input.startsWith('/api/mcp')) return json(200, mcp)
      if (input.startsWith('/api/secrets')) return json(200, { source: 'stored', secrets: [] })
      return json(404, { error: { code: 'not-found', message: 'not found' } })
    }),
  )
  const store = createAppearanceStore({ theme, locale })
  const { chat, settings } = createFixtureChat()
  const settingsPage = createSettingsPageStore()
  const preferences = createPreferences({ appearance: store, settings, onConflict: () => {}, onFailure: () => {} })
  await render(
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
  settingsPage.open('mcp')
  return { dialog: settingsRegion(), puts }
}

for (const locale of ['en', 'zh'] as const) {
  it(`Server 始终加载选项保存、回显与文案（${locale}）`, async () => {
    const { dialog, puts } = await mountMcp(
      {
        enabled: true,
        servers: [{ name: 'demo', scope: 'global', transport: 'stdio', enabled: true, status: 'idle', tools: [] }],
        global: { demo: { command: 'node' } },
        globalRevision: 0,
        diagnostics: [],
      },
      'light',
      locale,
    )
    const label = locale === 'en' ? 'Always load' : '始终加载'
    const hint =
      locale === 'en'
        ? 'This server\'s tools are always in the tool list, without a search first. Suited to servers used in almost every conversation. Only applies when "Load MCP tools on demand" is on.'
        : '此 Server 的工具始终出现在工具列表中，不需要先搜索。适合几乎每次对话都会用到的 Server。仅在开启「按需加载 MCP 工具」时生效。'
    const edit = dialog.getByRole('button', { name: locale === 'en' ? 'Edit' : '编辑', exact: true })
    const save = locale === 'en' ? 'Save' : '保存'
    await edit.click()
    const checkbox = dialog.getByRole('checkbox', { name: label, exact: true })
    await expect.element(checkbox).not.toBeChecked()
    await expect.element(dialog.getByText(hint, { exact: true })).toBeVisible()
    await checkbox.click()
    await dialog.getByRole('button', { name: save, exact: true }).click()
    await expect.poll(() => puts.length).toBe(1)
    expect(puts[0]!.servers).toEqual({ demo: { command: 'node', alwaysLoad: true } })
    await edit.click()
    await expect.element(checkbox).toBeChecked()
    await checkbox.click()
    await dialog.getByRole('button', { name: save, exact: true }).click()
    await expect.poll(() => puts.length).toBe(2)
    expect(puts[1]!.servers).toEqual({ demo: { command: 'node' } })
  })
}

const AUTH_MCP = {
  enabled: true,
  servers: [
    {
      name: 'remote',
      scope: 'global',
      transport: 'http',
      enabled: true,
      status: 'auth-required',
      error: 'MCP server "remote" requires authentication (HTTP 401)',
      tools: [],
    },
  ],
  global: { remote: { url: 'https://mcp.example/mcp', headers: { Authorization: 'Bearer ${OLD_TOKEN}' } } },
  globalRevision: 3,
  diagnostics: [{ source: 'mcp', code: 'mcp-auth-required', message: 'MCP server "remote" requires authentication: check the credentials' }],
}

for (const theme of ['light', 'dark'] as const) {
  it(`需要认证（${theme}）：徽标对比度 ≥ 4.5:1，说明与本地化诊断；"编辑请求头"打开表单并聚焦 headers`, async () => {
    const { dialog } = await mountMcp(AUTH_MCP, theme)
    const card = () => dialog.element().querySelector('[data-mcp-server="remote"]')!
    await expect.element(dialog.getByText('Authentication required', { exact: true })).toBeVisible()
    expect(contrastOf(card().querySelector('[data-mcp-status]')!)).toBeGreaterThanOrEqual(4.5)
    expect(card().querySelector('[data-mcp-auth]')?.textContent).toContain('reference a registered secret as ${NAME}')
    expect(dialog.element().querySelector('[data-diagnostic="mcp-auth-required"]')?.textContent).toContain('The server requires authentication')
    const edit = page.elementLocator(card()).getByRole('button', { name: 'Edit headers' })
    await edit.click()
    const headers = dialog.element().querySelector<HTMLTextAreaElement>('[data-mcp-form] textarea[name="headers"]')!
    await expect.poll(() => document.activeElement).toBe(headers)
    expect(headers.value).toBe('Authorization: Bearer ${OLD_TOKEN}')
  })
}

it('添加浏览器（键盘）：菜单列出预设 → 确认对话框显示完整命令 → 写入全局配置；名字冲突时提示改名，改名后保存', async () => {
  const existing = { enabled: true, servers: [], global: { Playwright: { command: 'node', args: ['other.js'] } }, globalRevision: 1, diagnostics: [] }
  const { dialog, puts } = await mountMcp(existing)
  const trigger = dialog.getByRole('button', { name: 'Add browser' })
  await expect.element(trigger).toBeEnabled()
  trigger.element().focus()
  await userEvent.keyboard('{Enter}')
  const item = page.getByRole('menuitem', { name: 'Browser (Playwright)' })
  await expect.element(item).toBeVisible()
  await expect.poll(() => document.activeElement?.getAttribute('role')).toBe('menuitem')
  await userEvent.keyboard('{Enter}')
  const confirm = page.getByRole('dialog', { name: 'Add a browser' })
  await expect.element(confirm).toBeVisible()
  await expect.poll(() => document.querySelector('[role=menu]')).toBeNull()
  expect(confirm.element().querySelector('[data-preset-command]')?.textContent).toBe('npx -y @playwright/mcp@0.0.83 --isolated')
  const name = page.elementLocator(confirm.element()).getByLabelText('Name', { exact: true })
  expect((name.element() as HTMLInputElement).value).toBe('playwright')

  // 与已有的 Playwright 只差大小写：不保存，提示改名并回到名称输入框。
  await page.elementLocator(confirm.element()).getByRole('button', { name: 'Add', exact: true }).click()
  await expect
    .element(page.elementLocator(confirm.element()).getByRole('alert'))
    .toHaveTextContent('A server named playwright already exists; choose another name')
  expect(puts).toEqual([])
  await expect.poll(() => document.activeElement).toBe(name.element())
  await name.fill('browser')
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => puts.length).toBe(1)
  expect(puts[0]!.servers).toEqual({ Playwright: { command: 'node', args: ['other.js'] }, browser: PRESET.config })
  await expect.poll(() => document.querySelector('[role=dialog]')).toBeNull()
})
