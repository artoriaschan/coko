// 设置 → Hooks 分区：全局 JSON 编辑（非法 JSON 与服务端诊断行内显示、不保存；revision 冲突提示并读回）、项目 Hook 的完整命令与三种状态、
// 批准、按事件分组的已加载清单、明暗主题下状态文字的对比度与键盘操作。fetch 在测试中替换为内存中的 /api/hooks。
import '../../styles.css'
import type { HooksConfig, HooksResponse, ProjectHookEntry } from '@coko/protocol'
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
const digest = (c: string) => c.repeat(64)
const LONG = `node /opt/hooks/guard.mjs --policy strict --log /tmp/${'x'.repeat(120)}.jsonl`

/** 内存中的 /api/hooks：PUT 校验 revision 与一条诊断规则（事件名 Bogus），POST 批准一个 digest。 */
function fakeHooks(initial: { hooks?: HooksConfig; entries?: ProjectHookEntry[] } = {}) {
  const state = { hooks: initial.hooks ?? {}, revision: 1, entries: initial.entries ?? [], puts: [] as unknown[] }
  const view = (): HooksResponse => ({
    enabled: true,
    global: { hooks: state.hooks, revision: state.revision, diagnostics: [] },
    project: { path: '/w/.coko/settings.json', entries: state.entries, diagnostics: [] },
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body))
      if (input.startsWith('/api/hooks/approvals')) {
        state.entries = state.entries.map((e) =>
          e.digest === body.digest ? { hookId: e.hookId, event: e.event, command: e.command, digest: e.digest, approved: true } : e,
        )
        return new Response(null, { status: 204 })
      }
      if (input.startsWith('/api/hooks') && method === 'PUT') {
        state.puts.push(body)
        if (body.expectedRevision !== state.revision) return json(409, { error: { code: 'revision-conflict', message: 'stale' } })
        if ('Bogus' in body.hooks)
          return json(400, {
            error: {
              code: 'bad-request',
              message: 'x',
              details: { diagnostics: [{ source: 'config', code: 'unknown-event', message: 'Unknown hook event Bogus' }] },
            },
          })
        state.hooks = body.hooks
        state.revision++
        return json(200, view())
      }
      if (input.startsWith('/api/hooks')) return json(200, view())
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
  settingsPage.open('hooks')
  const dialog = settingsRegion()
  await expect.element(dialog.getByRole('heading', { name: 'Hooks', level: 2 })).toBeVisible()
  return { screen, dialog }
}

it('全局 JSON：非法 JSON 与诊断行内显示且不保存；保存后读回；revision 冲突提示并换成最新值', async () => {
  const state = fakeHooks({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'old.sh' }] }] } })
  const { screen, dialog } = await open()
  const editor = dialog.getByRole('textbox', { name: 'Global hook configuration (JSON)' })
  await expect.element(editor).toHaveValue(JSON.stringify(state.hooks, null, 2))
  const save = dialog.getByRole('button', { name: 'Save', exact: true })
  await expect.element(save).toBeDisabled()

  await editor.fill('{ not json')
  await save.click()
  const problem = () => dialog.element().querySelector('[data-hooks-problem]')?.textContent ?? ''
  await expect.poll(problem).toMatch(/^Invalid JSON: /)
  await expect.element(editor).toHaveAttribute('aria-invalid', 'true')
  expect(state.puts).toEqual([])

  await editor.fill(JSON.stringify({ Bogus: [] }))
  await save.click()
  await expect.poll(problem).toMatch(/^The configuration has problems and was not saved/)
  await expect.element(dialog.getByText('Unknown hook event Bogus')).toBeVisible()
  expect(state.revision).toBe(1)

  const next = { UserPromptSubmit: [{ hooks: [{ type: 'command' as const, command: 'new.sh' }] }] }
  await editor.fill(JSON.stringify(next))
  await save.click()
  await expect.poll(() => state.revision).toBe(2)
  await expect.element(editor).toHaveValue(JSON.stringify(next, null, 2))
  await expect.poll(problem).toBe('')
  await expect.element(dialog.getByText('new.sh')).toBeVisible()

  // 别处已改到 revision 5：保存被拒绝，提示冲突，编辑区换成读回的最新值。
  state.revision = 5
  state.hooks = { Stop: [{ hooks: [{ type: 'command', command: 'elsewhere.sh' }] }] }
  await editor.fill(JSON.stringify({ Stop: [] }))
  await save.click()
  await expect.poll(problem).toBe('The configuration changed elsewhere; the latest version was loaded')
  await expect.element(editor).toHaveValue(JSON.stringify(state.hooks, null, 2))
  await screen.unmount()
})

for (const theme of ['light', 'dark'] as const) {
  it(`项目 Hook：完整命令、已批准 / 待批准 / 已改动，键盘批准后状态变化，已加载清单按事件分组（${theme}）`, async () => {
    fakeHooks({
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'global-guard.sh' }] }] },
      entries: [
        { hookId: 'project:PreToolUse:0:0', event: 'PreToolUse', matcher: 'Bash', command: 'approved.sh', digest: digest('a'), approved: true },
        { hookId: 'project:Stop:0:0', event: 'Stop', command: LONG, digest: digest('b'), approved: false },
        { hookId: 'project:UserPromptSubmit:0:0', event: 'UserPromptSubmit', command: 'edited.sh', digest: digest('c'), approved: false, changed: true },
      ],
    })
    const { screen, dialog } = await open(theme)
    const card = (id: string) => dialog.element().querySelector(`[data-project-hook="${id}"]`)!
    await expect.poll(() => card('project:Stop:0:0')?.getAttribute('data-status')).toBe('pending')
    expect(['project:PreToolUse:0:0', 'project:UserPromptSubmit:0:0'].map((id) => card(id).getAttribute('data-status'))).toEqual(['approved', 'changed'])
    // 完整命令：不截断，换行显示。
    const command = card('project:Stop:0:0').querySelector('[data-hook-command]')!
    expect(command.textContent).toBe(LONG)
    expect(command.scrollWidth).toBeLessThanOrEqual(command.clientWidth + 1)
    // 状态文字的对比度（警示色与成功色）。
    for (const id of ['project:PreToolUse:0:0', 'project:Stop:0:0'])
      expect(contrastOf(card(id).querySelector('[data-hook-status]')!)).toBeGreaterThanOrEqual(4.5)

    // 已加载：全局 Hook 与已批准的项目 Hook，按事件分组；待批准的不在其中。
    const loaded = [...dialog.element().querySelectorAll('[data-hooks-event]')].map((g) => [
      g.getAttribute('data-hooks-event'),
      [...g.querySelectorAll('[data-loaded-hook] code')].map((c) => c.textContent),
    ])
    expect(loaded).toEqual([['PreToolUse', ['global-guard.sh', 'approved.sh']]])

    // 键盘：聚焦"批准"后按 Enter。
    const approve = card('project:Stop:0:0').querySelector<HTMLButtonElement>('[data-action="approve-hook"]')!
    approve.focus()
    expect(approve.matches(':focus-visible') || document.activeElement === approve).toBe(true)
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => card('project:Stop:0:0')?.getAttribute('data-status')).toBe('approved')
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
