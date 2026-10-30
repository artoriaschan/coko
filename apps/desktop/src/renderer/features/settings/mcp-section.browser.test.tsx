// MCP 分区的错误文案（ui.md：错误用本地化的用户语言，技术详情放入诊断入口）：保存被服务端拒绝时显示本地化文案，服务端原文只在
// 可展开的技术详情中；删除 Secret 失败时 toast 只有本地化文案。fetch 在测试中替换（mcpStore 每次调用时取全局 fetch）。
import '../../styles.css'
import { afterEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
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

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

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
