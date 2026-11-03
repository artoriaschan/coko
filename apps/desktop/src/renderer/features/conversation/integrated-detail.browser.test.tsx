import '../../styles.css'
import { SessionEntry, type SessionEntryRecord } from '@coko/protocol'
import { Value } from 'typebox/value'
import { afterEach, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'

const entry = (seq: number, kind: string, payload: unknown): SessionEntryRecord => ({
  sessionId: 's-1',
  seq,
  kind,
  payloadVersion: 1,
  payload,
  runId: 'joint-run',
  createdAt: seq,
})
const call = (seq: number, id: string, name: string, args: unknown) =>
  entry(seq, 'message', { role: 'assistant', content: [{ type: 'toolCall', id, name, arguments: args }], stopReason: 'toolUse', timestamp: 0 })
const result = (seq: number, id: string, name: string, text: string, extra = {}) =>
  entry(seq, 'message', { role: 'toolResult', toolCallId: id, toolName: name, content: [{ type: 'text', text }], isError: false, timestamp: 0, ...extra })
const reply = (seq: number, text: string) =>
  entry(seq, 'message', { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'toolUse', timestamp: 0 })
const paragraphs = () => Array.from({ length: 16 }, (_, i) => reply(2 + i, `Joint reading marker ${i}\n\n${'Original retained paragraph. '.repeat(8)}`))
const outer = () => document.querySelector<HTMLElement>('.conversation-message-scroll')!
const distance = (element: HTMLElement) => element.scrollHeight - element.clientHeight - element.scrollTop
const viewport = { width: innerWidth, height: innerHeight }
afterEach(async () => {
  vi.restoreAllMocks()
  await page.viewport(viewport.width, viewport.height)
})

async function open(entries: SessionEntryRecord[], reduced = false) {
  if (reduced) {
    const original = window.matchMedia.bind(window)
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => {
      const media = original(query)
      if (query === '(prefers-reduced-motion: reduce)') Object.defineProperty(media, 'matches', { value: true })
      return media
    })
  }
  const fixture = createFixtureChat({ entries: { 's-1': entries } })
  const appearance = createAppearanceStore({ theme: 'dark', locale: 'en' })
  const preferences = createPreferences({ appearance, settings: fixture.settings, onConflict: () => {}, onFailure: () => {} })
  await render(
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
    </div>,
  )
  await expect.poll(() => fixture.chat.getState().conversations['s-1']?.status).toBe('ready')
  return fixture
}

function bitmap() {
  const canvas = document.createElement('canvas')
  canvas.width = 240
  canvas.height = 160
  canvas.getContext('2d')!.fillRect(0, 0, 240, 160)
  return { type: 'image', mimeType: 'image/png', data: canvas.toDataURL('image/png').split(',')[1]! }
}

const specializations = [
  {
    name: 'bash',
    args: { command: 'printf original' },
    text: Array.from({ length: 40 }, (_, i) => `Original terminal line ${i}`).join('\n'),
    selector: '[data-terminal-output]',
  },
  {
    name: 'read',
    args: { path: 'src/original.ts', offset: 21 },
    text: Array.from({ length: 40 }, (_, i) => `Original file line ${i}`).join('\n'),
    selector: '[data-file-detail="read"]',
  },
  {
    name: 'edit',
    args: { path: 'src/original.ts', edits: [{ oldText: 'old', newText: 'new' }] },
    text: 'Successfully replaced 1 block(s).',
    extra: { details: { diff: Array.from({ length: 40 }, (_, i) => `${i % 2 ? '+' : '-'}${i + 1} original line ${i}`).join('\n') } },
    selector: '[data-file-detail="edit"]',
  },
  {
    name: 'grep',
    args: { pattern: 'original' },
    text: Array.from({ length: 40 }, (_, i) => `src/original.ts:${i + 1}: original match`).join('\n'),
    selector: '[data-search-detail]',
  },
  { name: 'mcp__playwright__screenshot', args: { url: 'https://example.test' }, text: 'Original screenshot', selector: '[data-tool-image]' },
]

for (const specialized of specializations) {
  it(`actual App joint: ${specialized.name} height changes follow the group, retain the held outer reader and survive earlier history`, async () => {
    await page.viewport(1000, 800)
    const records = [
      entry(1, 'run_start', { trigger: 'submit' }),
      ...paragraphs().map((record) => ({ ...record, seq: record.seq + 100 })),
      ...Array.from({ length: 24 }, (_, i) => call(200 + i, `prefix-${i}`, 'custom', {})),
      call(224, 'specialized-tail', specialized.name, specialized.args),
      result(225, 'specialized-tail', specialized.name, specialized.text, specialized.name.startsWith('mcp__') ? { content: [bitmap()] } : specialized.extra),
      reply(226, 'Final original answer remains outside work steps.'),
      entry(227, 'run_end', { status: 'completed' }),
    ]
    const fixture = await open(records)
    await page.getByRole('button', { name: 'Work steps', exact: true }).click()
    const groupHeader = document.querySelector<HTMLButtonElement>('[data-slot="process-group-header"]')!
    await page.elementLocator(groupHeader).click()
    const group = document.querySelector<HTMLElement>('[data-slot="process-group-body"]')!
    await expect.poll(() => getComputedStyle(group).overflowY).toBe('auto')
    expect(group.clientHeight).toBe(400)
    group.scrollTop = group.scrollHeight
    group.dispatchEvent(new Event('scroll'))
    outer().scrollTop = 400
    outer().dispatchEvent(new Event('scroll'))
    const marker = [...outer().querySelectorAll<HTMLElement>('.conversation-assistant-message')].find(
      (row) => row.getBoundingClientRect().bottom > outer().getBoundingClientRect().top,
    )!
    const top = marker.getBoundingClientRect().top
    const before = group.scrollTop
    const tool = group.querySelector<HTMLElement>('[data-tool="' + specialized.name + '"]')!
    tool.querySelector<HTMLButtonElement>('button')!.click()
    await expect.poll(() => tool.querySelector(specialized.selector)).not.toBeNull()
    const image = tool.querySelector<HTMLImageElement>('[data-tool-image]')
    if (image) await image.decode()
    expect(image?.naturalWidth).toBe(specialized.name.startsWith('mcp__') ? 240 : undefined)
    await expect.poll(() => group.scrollTop).toBeGreaterThan(before + 100)
    await expect.poll(() => distance(group)).toBeLessThanOrEqual(1)
    expect(Math.abs(marker.getBoundingClientRect().top - top)).toBeLessThanOrEqual(1)
    const expand = tool.querySelector<HTMLButtonElement>('.file-detail-expand, .search-detail-expand')
    const expands = ['read', 'edit', 'grep'].includes(specialized.name)
    expect(Boolean(expand)).toBe(expands)
    const previewTop = group.scrollTop
    expand?.click()
    await expect.poll(() => group.scrollTop - previewTop).toBeGreaterThan(expands ? 100 : -1)
    await expect.poll(() => distance(group)).toBeLessThanOrEqual(1)
    expect(Math.abs(marker.getBoundingClientRect().top - top)).toBeLessThanOrEqual(1)
    const body = tool.querySelector('[data-slot="tool-card-body"]')!
    const original = tool.querySelector(specialized.selector)!
    // The existing snapshot input can reveal earlier history; no new paging protocol is introduced.
    fixture.chat.setState((state) => ({
      conversations: {
        ...state.conversations,
        's-1': {
          ...state.conversations['s-1']!,
          entries: [records[0]!, ...paragraphs(), ...records.slice(1)].filter((record): record is SessionEntry => Value.Check(SessionEntry, record)),
        },
      },
    }))
    await expect.poll(() => document.querySelectorAll('.conversation-assistant-message').length).toBe(33)
    expect(tool.querySelector('[data-slot="tool-card-body"]')).toBe(body)
    expect(tool.querySelector(specialized.selector)).toBe(original)
    expect(Math.abs(marker.getBoundingClientRect().top - top)).toBeLessThanOrEqual(1)
    await page.elementLocator(groupHeader).click()
    await expect.poll(() => group.getAnimations().length).toBeGreaterThan(0)
    const closing = group.getAnimations()[0]!
    closing.pause()
    closing.currentTime = 80
    await new Promise(requestAnimationFrame)
    await page.elementLocator(groupHeader).click()
    await expect.poll(() => getComputedStyle(group).overflowY).toBe('auto')
    expect(group.scrollTop).toBe(0)
    const whole = page.getByRole('button', { name: 'Work steps', exact: true })
    await whole.click()
    await whole.click()
    await expect.poll(() => groupHeader.getAttribute('aria-expanded')).toBe('false')
    expect(tool.querySelector('button')!.getAttribute('aria-expanded')).toBe('false')
    outer().scrollTop = 400
    outer().dispatchEvent(new Event('scroll'))
    await page.getByRole('button', { name: 'Return to bottom', exact: true }).click()
    await expect.poll(() => distance(outer())).toBeLessThanOrEqual(1)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(1000)
  })
}

it.each([false, true])(
  'actual App joint: live terminal commits through phase reply and image portal without losing entities, selection or focus (reduce=%s)',
  async (reduced) => {
    await page.viewport(390, 800)
    const fixture = await open([entry(1, 'run_start', { trigger: 'submit' }), ...paragraphs()], reduced)
    const progress = (event: Parameters<typeof fixture.sendServer>[0] & { type: 'progress' }) => fixture.sendServer(event)
    progress({ type: 'progress', sessionId: 's-1', runId: 'joint-run', event: { type: 'run_start' } })
    progress({
      type: 'progress',
      sessionId: 's-1',
      runId: 'joint-run',
      event: { type: 'tool_start', toolCallId: 'terminal', toolName: 'bash', args: { command: 'printf original' } },
    })
    const terminalTool = () => document.querySelector<HTMLElement>('[data-tool="bash"]')!
    await expect.poll(terminalTool).not.toBeNull()
    terminalTool().querySelector<HTMLButtonElement>('button')!.click()
    progress({
      type: 'progress',
      sessionId: 's-1',
      runId: 'joint-run',
      event: {
        type: 'tool_update',
        toolCallId: 'terminal',
        toolName: 'bash',
        partialResult: { content: [{ type: 'text', text: 'first unchanged line\nsecond unchanged line\n' }] },
      },
    })
    await expect.poll(() => terminalTool()?.querySelector('[data-terminal-output]')).toBeTruthy()
    const terminal = terminalTool()
    const output = terminal.querySelector<HTMLElement>('[data-terminal-output]')!
    const text = document.createTreeWalker(output, NodeFilter.SHOW_TEXT).nextNode()!
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, 20)
    getSelection()!.removeAllRanges()
    getSelection()!.addRange(range)
    const selected = getSelection()!.toString()
    fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: call(18, 'terminal', 'bash', { command: 'printf original' }) })
    fixture.sendServer({
      type: 'entry',
      sessionId: 's-1',
      entry: result(19, 'terminal', 'bash', 'first unchanged line\nsecond unchanged line\n' + 'Original terminal growth\n'.repeat(50)),
    })
    await expect.poll(() => terminal.getAttribute('data-status')).toBe('done')
    expect(terminalTool()).toBe(terminal)
    expect(terminal.querySelector('[data-terminal-output]')).toBe(output)
    expect(getSelection()!.toString()).toBe(selected)
    await expect.poll(() => distance(outer())).toBeLessThanOrEqual(1)
    fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: reply(20, 'Phase answer stays visible.') })
    fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: call(21, 'image-tail', 'read', { path: 'original.png' }) })
    fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: result(22, 'image-tail', 'read', '', { content: [bitmap()] }) })
    await expect.poll(() => document.querySelectorAll('[data-slot="process-group"]').length).toBe(2)
    expect([...document.querySelectorAll<HTMLElement>('[data-slot="process-group-header"]')].every((header) => !header.checkVisibility())).toBe(true)
    document.querySelector<HTMLButtonElement>('[data-tool="read"] button')!.click()
    await expect.poll(() => document.querySelector('[data-action="open-image"]')).not.toBeNull()
    const opener = document.querySelector<HTMLButtonElement>('[data-action="open-image"]')!
    await expect.poll(() => opener.querySelector('img')!.naturalWidth).toBe(240)
    opener.focus()
    await userEvent.keyboard('{Enter}')
    await expect.element(page.getByRole('dialog')).toBeVisible()
    fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: reply(23, 'Final answer stays visible.') })
    fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: entry(24, 'run_end', { status: 'completed' }) })
    await expect.poll(() => document.querySelector('[data-slot="run-process-control"]')?.getAttribute('aria-expanded')).toBe('true')
    expect(page.getByRole('dialog').element().getBoundingClientRect().width).toBe(390)
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(opener)
    expect(opener.checkVisibility()).toBe(true)
    const whole = page.getByRole('button', { name: 'Work steps', exact: true })
    await whole.click()
    await expect.poll(() => [...document.querySelectorAll<HTMLElement>('[data-slot="process-seat"]')].every((seat) => seat.hidden)).toBe(true)
    expect(document.activeElement).toBe(whole.element())
    await expect.element(page.getByText('Phase answer stays visible.', { exact: true })).toBeVisible()
    await expect.element(page.getByText('Final answer stays visible.', { exact: true })).toBeVisible()
    expect([...document.querySelectorAll<HTMLElement>('[data-slot="process-seat"]')].flatMap((seat) => seat.getAnimations())).toHaveLength(0)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
  },
)
