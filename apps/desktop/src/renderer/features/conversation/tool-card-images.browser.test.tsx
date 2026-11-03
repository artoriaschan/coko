// Actual App assembly: MCP bitmap gallery, live settlement, failure and keyboard preview.
import '../../styles.css'
import type { SessionEntryRecord } from '@coko/protocol'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { createAgentsStore } from '../../stores/agents-store.ts'
import { AgentsStoreProvider } from './agents-button.tsx'
import { createFixtureChat } from '../../testing/fixture-chat.ts'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg=='
const bitmap = { type: 'image', data: PNG, mimeType: 'image/png' }
const name = 'mcp__playwright__screenshot'
const entry = (seq: number, kind: string, payload: unknown): SessionEntryRecord => ({
  sessionId: 's-1',
  seq,
  kind,
  payloadVersion: 1,
  payload,
  runId: 'run-1',
  createdAt: seq,
})
const call = (seq: number, id = 'image', toolName = name, args: Record<string, unknown> = { url: 'https://example.test' }) =>
  entry(seq, 'message', {
    role: 'assistant',
    content: [{ type: 'toolCall', id, name: toolName, arguments: args }],
    stopReason: 'toolUse',
    timestamp: 0,
  })
const result = (seq: number, content: unknown[], toolName = name) =>
  entry(seq, 'message', { role: 'toolResult', toolCallId: 'image', toolName, content, isError: false, timestamp: 0 })
let viewport = { width: 0, height: 0 }
beforeEach(() => {
  viewport = { width: innerWidth, height: innerHeight }
})
afterEach(async () => {
  await page.viewport(viewport.width, viewport.height)
})
async function open(entries: SessionEntryRecord[], theme: 'light' | 'dark' = 'light', locale: 'en' | 'zh' = 'en', childEntries?: SessionEntryRecord[]) {
  const fixture = createFixtureChat({
    entries: { 's-1': entries, ...(childEntries ? { child: childEntries.map((record) => ({ ...record, sessionId: 'child' })) } : {}) },
  })
  const appearance = createAppearanceStore({ theme, locale })
  const preferences = createPreferences({ appearance, settings: fixture.settings, onConflict: () => {}, onFailure: () => {} })
  const agents = createAgentsStore({
    list: async () =>
      childEntries
        ? [{ agentId: 'child', agentType: 'explore', description: 'child images', status: 'completed', background: false, startedAt: 1, endedAt: 2 }]
        : [],
    cancel: async () => {},
    definitions: async () => ({ definitions: [], diagnostics: [] }),
    answer: async () => {},
  })
  await render(
    <AgentsStoreProvider store={agents}>
      <div style={{ width: '100vw', height: '100vh' }}>
        <App
          store={appearance}
          connection={createConnectionStore()}
          chat={fixture.chat}
          settings={fixture.settings}
          preferences={preferences}
          settingsPage={createSettingsPageStore()}
          pickDirectory={async () => null}
        />
      </div>
    </AgentsStoreProvider>,
  )
  await expect.poll(() => fixture.chat.getState().conversations['s-1']?.status).toBe('ready')
  // ResizeObserver changes the initial wide shell to the real narrow layout.
  // Measure the gallery after its actual grid transition, not its transient 110px column.
  await Promise.all(
    document
      .querySelector('[data-slot="app-frame"]')!
      .getAnimations()
      .map((animation) => animation.finished),
  )
  return fixture
}

it('actual App: partial bitmap becomes committed without duplicating, remounting or resetting the open preview', async () => {
  const fixture = await open([entry(1, 'run_start', { trigger: 'submit' })])
  fixture.sendServer({
    type: 'progress',
    sessionId: 's-1',
    runId: 'run-1',
    event: { type: 'tool_start', toolCallId: 'image', toolName: name, args: { url: 'https://example.test' } },
  })
  const content = [{ type: 'text', text: 'Screenshot text stays selectable' }, bitmap, { ...bitmap, data: PNG + '\n' }]
  fixture.sendServer({
    type: 'progress',
    sessionId: 's-1',
    runId: 'run-1',
    event: { type: 'tool_update', toolCallId: 'image', toolName: name, partialResult: { content } },
  })
  const header = page.getByRole('button', { name: /Tool call/ })
  await header.click()
  const headerElement = header.element()
  const thumbs = () => [...document.querySelectorAll<HTMLImageElement>('[data-tool-image]')]
  await expect.poll(() => thumbs().length).toBe(2)
  await expect.poll(() => thumbs()[0]!.naturalWidth).toBe(2)
  const original = thumbs()
  const buttons = document.querySelectorAll<HTMLButtonElement>('[data-action="open-image"]')
  buttons[1]!.focus()
  await userEvent.keyboard('{Enter}')
  const dialog = page.getByRole('dialog')
  await expect.element(dialog).toBeVisible()
  const full = dialog.element().querySelector('img')!
  const src = full.src
  const input = document.querySelector('.tool-io-text')!
  const inputRange = document.createRange()
  inputRange.selectNodeContents(input)
  getSelection()!.removeAllRanges()
  getSelection()!.addRange(inputRange)
  const selectedInput = getSelection()!.toString()
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: call(2) })
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: result(3, [{ type: 'text', text: 'committed prefix' }, ...content]) })
  await expect.poll(() => document.querySelector('[data-slot="tool-card"]')?.getAttribute('data-status')).toBe('done')
  expect(thumbs()).toEqual(original)
  expect(document.querySelectorAll('[data-slot="tool-card"]')).toHaveLength(1)
  expect(dialog.element().querySelector('img')).toBe(full)
  expect(full.src).toBe(src)
  expect(getSelection()!.toString()).toBe(selectedInput)
  expect(dialog.element().textContent).toContain('Image 2')
  const preview = dialog.element()
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: entry(4, 'run_end', { status: 'completed' }) })
  await expect.poll(() => fixture.chat.getState().conversations['s-1']?.running).toBe(false)
  expect(document.querySelector('[data-tool-image-dialog]')).toBe(preview)
  expect(document.querySelector('[data-slot="run-process-control"]')?.getAttribute('aria-expanded')).toBe('true')
  expect(document.querySelector('[data-slot="process-group-header"]')?.getAttribute('aria-expanded')).toBe('true')
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(buttons[1])
  expect(buttons[1]!.checkVisibility()).toBe(true)
  expect(headerElement.getAttribute('aria-expanded')).toBe('true')
})

it.each([
  ['light', 'en'],
  ['light', 'zh'],
  ['dark', 'en'],
  ['dark', 'zh'],
] as const)('actual App: %s/%s multiple images, mixed text, blocked sources and decoding failures fit 390px', async (theme, locale) => {
  await page.viewport(390, 800)
  const long = '原文 preserved / ' + 'long-description-'.repeat(80)
  await open(
    [
      entry(1, 'run_start', { trigger: 'submit' }),
      call(2),
      result(3, [
        { type: 'text', text: long },
        bitmap,
        bitmap,
        { type: 'image', data: btoa('not a bitmap'), mimeType: 'image/png' },
        { type: 'image', data: btoa('<svg/>'), mimeType: 'image/svg+xml' },
        { type: 'image', data: 'https://example.test/image.png', mimeType: 'image/png' },
        { type: 'image', url: 'https://example.test/image.png', mimeType: 'image/png' },
      ]),
    ],
    theme,
    locale,
  )
  const header = page.getByRole('button', { name: /Tool call|工具调用/ })
  await header.click()
  await expect.poll(() => document.querySelectorAll('[data-tool-image]').length).toBe(2)
  const failed = page.getByRole('button', { name: /could not be loaded|图片加载失败/ })
  await expect.element(failed).toBeVisible()
  await expect.element(failed).toBeDisabled()
  expect(document.querySelector('.tool-io-section:last-child .tool-io-text')!.textContent).toBe(long)
  expect(document.querySelectorAll('.tool-image-frame')).toHaveLength(3)
  const frames = [...document.querySelectorAll<HTMLElement>('.tool-image-frame')]
  expect(frames.map((el) => el.getBoundingClientRect().width)).toEqual([64, 64, 64])
  expect(Math.round(frames[1]!.getBoundingClientRect().left - frames[0]!.getBoundingClientRect().right)).toBe(10)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth)
  expect(document.querySelector('.tool-image-details')!.textContent).toContain(locale === 'en' ? 'Decoded size: 2 × 2' : '解码尺寸：2 × 2')
  const openers = document.querySelectorAll<HTMLButtonElement>('[data-action="open-image"]')
  await page.elementLocator(openers[0]!).click()
  await expect.element(page.getByRole('dialog')).toBeVisible()
  const bounds = page.getByRole('dialog').element().getBoundingClientRect()
  expect([bounds.x, bounds.y, bounds.width, bounds.height]).toEqual([0, 0, 390, 800])
  await page.getByRole('button', { name: locale === 'en' ? 'Close' : '关闭', exact: true }).click()
  await expect.poll(() => document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(openers[0])
  expect(header.element().getAttribute('aria-expanded')).toBe('true')
})

it('actual App: a child Session gallery reads the child result while the parent remains active', async () => {
  const fixture = await open([entry(1, 'message', { role: 'user', content: 'parent has no images', timestamp: 0 })], 'light', 'en', [
    entry(1, 'run_start', { trigger: 'submit' }),
    call(2),
    result(3, [bitmap]),
  ])
  await page.getByRole('button', { name: 'Subagents', exact: true }).click()
  await expect.poll(() => document.querySelector('[data-slot="agent-timeline"]')?.textContent).toContain(name)
  const timeline = document.querySelector<HTMLElement>('[data-slot="agent-timeline"]')!
  await page
    .elementLocator(timeline)
    .getByRole('button', { name: /Tool call/ })
    .click()
  await expect.poll(() => timeline.querySelector<HTMLImageElement>('[data-tool-image]')?.naturalWidth).toBe(2)
  expect(fixture.chat.getState().activeSessionId).toBe('s-1')
  expect(document.querySelectorAll('[data-tool-image]')).toHaveLength(1)
})

it('actual App: single bitmap measures its natural size; final empty content removes stale live images and preview', async () => {
  const canvas = document.createElement('canvas')
  canvas.width = 160
  canvas.height = 100
  canvas.getContext('2d')!.fillRect(0, 0, 160, 100)
  const image = { type: 'image', mimeType: 'image/png', data: canvas.toDataURL('image/png').split(',')[1]! }
  const fixture = await open([entry(1, 'run_start', { trigger: 'submit' }), call(2, 'image', 'read', { path: '/fixture.png' })])
  fixture.sendServer({
    type: 'progress',
    sessionId: 's-1',
    runId: 'run-1',
    event: { type: 'tool_start', toolCallId: 'image', toolName: 'read', args: { path: '/fixture.png' } },
  })
  fixture.sendServer({
    type: 'progress',
    sessionId: 's-1',
    runId: 'run-1',
    event: { type: 'tool_update', toolCallId: 'image', toolName: 'read', partialResult: { content: [image] } },
  })
  await page.getByRole('button', { name: /Read/ }).click()
  const opener = document.querySelector<HTMLButtonElement>('[data-action="open-image"]')!
  await expect.poll(() => opener.getBoundingClientRect().width).toBe(160)
  expect(opener.getBoundingClientRect().height).toBe(100)
  expect(document.querySelector('.tool-image-meta')!.textContent).toBe('Decoded size: 160 × 100')
  await page.elementLocator(opener).click()
  await expect.element(page.getByRole('dialog')).toBeVisible()
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: result(3, [{ type: 'text', text: 'final result intentionally contains no image' }], 'read') })
  await expect.poll(() => document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.querySelector('[data-tool-image]')).toBeNull()
  await expect.element(page.getByText('final result intentionally contains no image', { exact: true })).toBeVisible()
})
