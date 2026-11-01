// 设置 → 代码智能分区：全局 JSON 编辑（非法 JSON 与服务端诊断行内显示、不保存；保存后列表显示服务器；revision 冲突提示并读回）、服务器列表的来源、
// 扩展名、状态与 stderr 尾部，键盘"重启"，明暗主题下状态文字的对比度。fetch 在测试中替换为内存中的 /api/lsp。
import '../../styles.css'
import type { LspResponse, LspServersConfig, LspServerStatus } from '@coko/protocol'
import { afterEach, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'
import { settingsRegion } from '../../testing/settings-page.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.classList.remove('dark')
})

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** 内存中的 /api/lsp：PUT 校验 revision 与扩展名写法（不以点开头为 invalid-lsp-server），POST 重启把状态设为 running。 */
function fakeLsp(initial: { servers?: LspServersConfig; status?: LspServerStatus[] } = {}) {
  const state = { servers: initial.servers ?? {}, revision: 1, status: initial.status ?? [], puts: [] as unknown[], restarts: [] as unknown[] }
  const view = (): LspResponse => ({ enabled: true, global: { servers: state.servers, revision: state.revision, diagnostics: [] }, status: state.status })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body))
      if (input.startsWith('/api/lsp/restart')) {
        state.restarts.push(body)
        state.status = state.status.map((s) => (s.name === body.name ? { ...s, state: 'running', pid: 4242, error: undefined } : s)) as LspServerStatus[]
        return new Response(null, { status: 204 })
      }
      if (input.startsWith('/api/lsp') && method === 'PUT') {
        state.puts.push(body)
        if (body.expectedRevision !== state.revision) return json(409, { error: { code: 'revision-conflict', message: 'stale' } })
        const bad = Object.entries(body.servers as LspServersConfig).find(([, s]) => Object.keys(s.extensionToLanguage).some((e) => !e.startsWith('.')))
        if (bad)
          return json(400, {
            error: {
              code: 'bad-request',
              message: 'x',
              details: { diagnostics: [{ source: 'lsp', code: 'invalid-lsp-server', message: `lsp.servers.${bad[0]}: extensions must look like .ts` }] },
            },
          })
        state.servers = body.servers
        state.revision++
        state.status = Object.entries(state.servers).map(([name, s]) => ({
          name,
          source: 'global',
          extensions: Object.keys(s.extensionToLanguage),
          state: 'idle',
        }))
        return json(200, view())
      }
      if (input.startsWith('/api/lsp')) return json(200, view())
      if (input.startsWith('/api/config')) return json(200, { effective: {}, global: {}, globalRevision: 0 })
      return json(404, { error: { code: 'not-found', message: 'not found' } })
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
  settingsPage.open('lsp')
  const dialog = settingsRegion()
  await expect.element(dialog.getByRole('heading', { name: 'Code intelligence', level: 2 })).toBeVisible()
  return { screen, dialog }
}

it('全局 JSON：非法 JSON 与诊断行内显示且不保存；保存后列表显示服务器；revision 冲突提示并换成最新值', async () => {
  const state = fakeLsp()
  const { screen, dialog } = await open()
  const editor = dialog.getByRole('textbox', { name: 'Global language server configuration (JSON)' })
  await expect.element(editor).toHaveValue('{}')
  await expect.element(dialog.getByText('No language servers configured yet')).toBeVisible()
  const save = () => dialog.element().querySelector<HTMLButtonElement>('[data-action="save-lsp-global"]')!
  expect(save().disabled).toBe(true)
  const problem = () => dialog.element().querySelector('[data-lsp-problem]')?.textContent ?? ''

  await editor.fill('{ not json')
  save().click()
  await expect.poll(problem).toMatch(/^Invalid JSON: /)
  await expect.element(editor).toHaveAttribute('aria-invalid', 'true')
  expect(state.puts).toEqual([])

  await editor.fill(JSON.stringify({ ts: { command: 'tsls', extensionToLanguage: { ts: 'typescript' } } }))
  save().click()
  await expect.poll(problem).toMatch(/^The configuration has problems and was not saved/)
  await expect.element(dialog.getByText('lsp.servers.ts: extensions must look like .ts')).toBeVisible()
  expect(state.revision).toBe(1)

  const next = { ts: { command: 'tsls', args: ['--stdio'], extensionToLanguage: { '.ts': 'typescript', '.tsx': 'typescriptreact' } } }
  await editor.fill(JSON.stringify(next))
  save().click()
  await expect.poll(() => state.revision).toBe(2)
  await expect.element(editor).toHaveValue(JSON.stringify(next, null, 2))
  await expect.poll(problem).toBe('')
  const row = () => dialog.element().querySelector('[data-lsp-server="ts"]')
  await expect.poll(() => row()?.getAttribute('data-state')).toBe('idle')
  expect(row()!.textContent).toContain('.ts .tsx')
  expect(row()!.textContent).toContain('Global')

  state.revision = 5
  state.servers = { py: { command: 'pyls', extensionToLanguage: { '.py': 'python' } } }
  await editor.fill(JSON.stringify({}))
  save().click()
  await expect.poll(problem).toBe('The configuration changed elsewhere; the latest version was loaded')
  await expect.element(editor).toHaveValue(JSON.stringify(state.servers, null, 2))
  await screen.unmount()
})

for (const theme of ['light', 'dark'] as const) {
  it(`服务器列表：来源、状态与 stderr 尾部，键盘重启后 running；状态文字对比度（${theme}）`, async () => {
    const state = fakeLsp({
      servers: { ts: { command: 'tsls', extensionToLanguage: { '.ts': 'typescript' } } },
      status: [
        {
          name: 'ts',
          source: 'global',
          extensions: ['.ts'],
          state: 'failed',
          cwd: '/w',
          error: 'The language server exited (code 1) before answering',
          stderrTail: 'boom [REDACTED:secret]',
        },
        { name: 'sample:py', source: 'plugin', extensions: ['.py'], state: 'running', cwd: '/w', pid: 99 },
        { name: 'go', source: 'global', extensions: ['.go'], state: 'starting' },
      ],
    })
    const { screen, dialog } = await open(theme)
    const row = (name: string) => dialog.element().querySelector(`[data-lsp-server="${name}"]`)!
    await expect.poll(() => row('ts')?.getAttribute('data-state')).toBe('failed')
    expect(row('ts').querySelector('[data-lsp-error]')!.textContent).toContain('before answering')
    expect(row('ts').querySelector('[data-lsp-stderr]')!.textContent).toBe('boom [REDACTED:secret]')
    expect(row('sample:py').textContent).toContain('Plugin')
    expect(row('sample:py').textContent).toContain('Process 99')
    // 运行中与启动中的状态文字（success-text、warning-text）的对比度；failed 用共享的 destructive 色，与其他分区的错误文字相同。
    for (const name of ['sample:py', 'go']) expect(contrastOf(row(name).querySelector('[data-lsp-state]')!)).toBeGreaterThanOrEqual(4.5)

    const restart = row('ts').querySelector<HTMLButtonElement>('[data-action="restart-lsp"]')!
    restart.focus()
    expect(document.activeElement).toBe(restart)
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => row('ts')?.getAttribute('data-state')).toBe('running')
    expect(state.restarts).toEqual([{ name: 'ts', cwd: '/w' }])
    await screen.unmount()
  })
}

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
