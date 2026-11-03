import '../../styles.css'
import { SessionEntry, type SessionEntryRecord } from '@coko/protocol'
import { Value } from 'typebox/value'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
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

const entry = (seq: number, kind: string, payload: unknown): SessionEntryRecord => ({
  sessionId: 's-1',
  seq,
  kind,
  payloadVersion: 1,
  payload,
  runId: 'run-1',
  createdAt: seq,
})
const call = (seq: number, id: string, name: string, args: unknown) =>
  entry(seq, 'message', { role: 'assistant', content: [{ type: 'toolCall', id, name, arguments: args }], stopReason: 'toolUse', timestamp: 0 })
const result = (seq: number, id: string, text: string, isError = false) =>
  entry(seq, 'message', { role: 'toolResult', toolCallId: id, toolName: 'custom', content: [{ type: 'text', text }], isError, timestamp: 0 })

let viewport = { width: 0, height: 0 }
beforeEach(() => {
  viewport = { width: window.innerWidth, height: window.innerHeight }
})
afterEach(async () => {
  vi.restoreAllMocks()
  await page.viewport(viewport.width, viewport.height)
})

async function open(
  entries: SessionEntryRecord[],
  theme: 'light' | 'dark' = 'light',
  locale: 'zh' | 'en' = 'en',
  children?: { agents: ReturnType<typeof createAgentsStore>; entries: Record<string, SessionEntryRecord[]> },
) {
  const fixture = createFixtureChat({ entries: { 's-1': entries, ...children?.entries } })
  const appearance = createAppearanceStore({ theme, locale })
  const preferences = createPreferences({ appearance, settings: fixture.settings, onConflict: () => {}, onFailure: () => {} })
  const app = (
    <App
      store={appearance}
      connection={createConnectionStore()}
      chat={fixture.chat}
      settings={fixture.settings}
      preferences={preferences}
      settingsPage={createSettingsPageStore()}
      pickDirectory={async () => null}
    />
  )
  await render(
    <div style={{ width: '100vw', height: '100vh' }}>{children ? <AgentsStoreProvider store={children.agents}>{app}</AgentsStoreProvider> : app}</div>,
  )
  await expect.poll(() => fixture.chat.getState().conversations['s-1']?.status).toBe('ready')
  return fixture
}

const reply = (seq: number, text: string) =>
  entry(seq, 'message', { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'toolUse', timestamp: 0 })
const longReplies = () => Array.from({ length: 16 }, (_, i) => reply(i + 2, `Reading marker ${i}\n\n${'Retained original paragraph. '.repeat(8)}`))
const outer = () => document.querySelector<HTMLElement>('.conversation-message-scroll')!
const distance = (element: HTMLElement) => element.scrollHeight - element.clientHeight - element.scrollTop

it('actual App: follows measured generic detail growth at the tail without a new Session entry', async () => {
  await page.viewport(1000, 800)
  await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    ...longReplies(),
    call(18, 'growing', 'custom', { query: 'inspect' }),
    result(19, 'growing', Array.from({ length: 60 }, (_, i) => `Actual output ${i}`).join('\n')),
  ])
  await expect.poll(() => distance(outer())).toBeLessThanOrEqual(1)
  const before = outer().scrollTop
  document.querySelector<HTMLButtonElement>('[data-slot="tool-card"] button')!.click()
  await expect.poll(() => document.querySelector('[data-slot="tool-card-body"]')).not.toBeNull()
  await expect.poll(() => outer().scrollTop).toBeGreaterThan(before + 100)
  expect(distance(outer())).toBeLessThanOrEqual(1)
})

it.each(['light', 'dark'] as const)(
  'actual App: %s held reading survives output, settlement and Run end, and return to bottom resumes follow at 390px',
  async (theme) => {
    await page.viewport(390, 800)
    const fixture = await open([entry(1, 'run_start', { trigger: 'submit' }), ...longReplies()], theme)
    const scroller = outer()
    scroller.scrollTop = 400
    scroller.dispatchEvent(new Event('scroll'))
    const marker = [...document.querySelectorAll<HTMLElement>('.conversation-assistant-message')].find(
      (row) => row.getBoundingClientRect().bottom > scroller.getBoundingClientRect().top,
    )!
    const top = marker.getBoundingClientRect().top
    fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: call(18, 'live-output', 'custom', {}) })
    fixture.sendServer({
      type: 'progress',
      sessionId: 's-1',
      runId: 'run-1',
      event: { type: 'tool_start', toolCallId: 'live-output', toolName: 'custom', args: {} },
    })
    fixture.sendServer({
      type: 'progress',
      sessionId: 's-1',
      runId: 'run-1',
      event: {
        type: 'tool_update',
        toolCallId: 'live-output',
        toolName: 'custom',
        partialResult: { content: [{ type: 'text', text: 'Real streamed output\n'.repeat(80) }] },
      },
    })
    await expect.element(page.getByRole('button', { name: /Tool call/ })).toBeInTheDocument()
    fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: result(19, 'live-output', 'Real streamed output\n'.repeat(80)) })
    fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: entry(20, 'run_end', { status: 'completed' }) })
    await expect.poll(() => document.querySelector('[data-slot="run-process-control"]')?.getAttribute('aria-expanded')).toBe('false')
    expect(Math.abs(marker.getBoundingClientRect().top - top)).toBeLessThanOrEqual(1)
    expect(distance(scroller)).toBeGreaterThan(100)
    await page.getByRole('button', { name: 'Return to bottom', exact: true }).click()
    expect(document.activeElement === scroller).toBe(true)
    await expect.poll(() => distance(scroller)).toBeLessThanOrEqual(1)
    fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: reply(21, 'New tail\n\n' + 'Real next answer. '.repeat(80)) })
    await expect.element(page.getByText(/New tail/)).toBeInTheDocument()
    await expect.poll(() => distance(scroller)).toBeLessThanOrEqual(1)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
  },
)

it('actual App: expanded historical snapshot preserves the current visible row and manual disclosure after a later reading gesture', async () => {
  await page.viewport(1000, 800)
  const records = [
    entry(1, 'run_start', { trigger: 'submit' }),
    ...longReplies().map((record) => ({ ...record, seq: record.seq + 100 })),
    call(118, 'history-tool', 'custom', {}),
    result(119, 'history-tool', 'Actual retained detail'),
    entry(120, 'run_end', { status: 'completed' }),
  ]
  const fixture = await open(records)
  await page.getByRole('button', { name: 'Work steps', exact: true }).click()
  await page.getByRole('button', { name: 'Called tools', exact: true }).click()
  document.querySelector<HTMLButtonElement>('[data-slot="tool-card"] button')!.click()
  await expect.poll(() => document.querySelector('[data-slot="tool-card-body"]')).not.toBeNull()
  const body = document.querySelector('[data-slot="tool-card-body"]')!
  const scroller = outer()
  scroller.scrollTop = 300
  scroller.dispatchEvent(new Event('scroll'))
  // A pending source snapshot must not retain the position that preceded the reader's new gesture.
  const pending = Promise.withResolvers<void>()
  const restore = pending.promise.then(() =>
    fixture.chat.setState((state) => ({
      conversations: {
        ...state.conversations,
        's-1': {
          ...state.conversations['s-1']!,
          entries: [records[0]!, ...longReplies(), ...records.slice(1)].filter((record): record is SessionEntry => Value.Check(SessionEntry, record)),
        },
      },
    })),
  )
  scroller.scrollTop = 550
  scroller.dispatchEvent(new Event('scroll'))
  const marker = [...document.querySelectorAll<HTMLElement>('.conversation-assistant-message')].find(
    (row) => row.getBoundingClientRect().bottom > scroller.getBoundingClientRect().top,
  )!
  const top = marker.getBoundingClientRect().top
  pending.resolve()
  await restore
  await expect.poll(() => document.querySelectorAll('.conversation-assistant-message').length).toBe(32)
  expect(Math.abs(marker.getBoundingClientRect().top - top)).toBeLessThanOrEqual(1)
  expect(document.querySelector('[data-slot="tool-card-body"]')).toBe(body)
  expect(page.getByRole('button', { name: 'Called tools', exact: true }).element().getAttribute('aria-expanded')).toBe('true')
})

it('actual App: a capped group follows detail growth independently while the outer reader remains held; manual reopen starts at the top', async () => {
  await page.viewport(1000, 800)
  await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    ...longReplies(),
    ...Array.from({ length: 24 }, (_, i) => [
      call(18 + i * 2, `nested-${i}`, 'custom', {}),
      result(19 + i * 2, `nested-${i}`, 'Nested actual output\n'.repeat(60)),
    ]).flat(),
    entry(66, 'run_end', { status: 'error' }),
  ])
  await page.getByRole('button', { name: 'Called tools', exact: true }).click()
  const group = document.querySelector<HTMLElement>('[data-slot="process-group-body"]')!
  await expect.poll(() => group.clientHeight).toBe(400)
  await expect.poll(() => getComputedStyle(group).overflowY).toBe('auto')
  expect(group.scrollTop).toBe(0)
  group.scrollTop = group.scrollHeight
  group.dispatchEvent(new Event('scroll'))
  const scroller = outer()
  scroller.scrollTop = 400
  scroller.dispatchEvent(new Event('scroll'))
  const top = scroller.scrollTop
  const before = group.scrollTop
  group.querySelectorAll<HTMLButtonElement>('[data-slot="tool-card"] button')[23]!.click()
  await expect.poll(() => group.scrollTop).toBeGreaterThan(before + 100)
  expect(distance(group)).toBeLessThanOrEqual(1)
  expect(scroller.scrollTop).toBe(top)
  await page.getByRole('button', { name: 'Called tools', exact: true }).click()
  await page.getByRole('button', { name: 'Called tools', exact: true }).click()
  await expect.poll(() => group.clientHeight).toBe(400)
  await expect.poll(() => getComputedStyle(group).overflowY).toBe('auto')
  expect(group.scrollTop).toBe(0)
})

it('actual App: child Session detail growth follows its own tail, child switching resets reading, and the parent stays held', async () => {
  await page.viewport(1200, 900)
  const childEntries = (id: string) =>
    [
      entry(1, 'run_start', { trigger: 'submit' }),
      ...longReplies(),
      call(18, 'child-growth', 'custom', {}),
      result(19, 'child-growth', 'Real child output\n'.repeat(60)),
    ].map((record) => ({ ...record, sessionId: id }))
  const agents = createAgentsStore({
    list: async () =>
      ['child-a', 'child-b'].map((id) => ({
        agentId: id,
        agentType: 'general',
        description: id,
        status: 'completed',
        background: false,
        startedAt: 1,
        endedAt: 2,
      })),
    cancel: async () => {},
    definitions: async () => ({ definitions: [], diagnostics: [] }),
    answer: async () => {},
  })
  await open([entry(1, 'run_start', { trigger: 'submit' }), ...longReplies()], 'light', 'en', {
    agents,
    entries: { 'child-a': childEntries('child-a'), 'child-b': childEntries('child-b') },
  })
  await expect.poll(() => outer().scrollHeight - outer().clientHeight).toBeGreaterThan(800)
  outer().scrollTop = 400
  outer().dispatchEvent(new Event('scroll'))
  expect(outer().scrollTop).toBe(400)
  const parentMarker = [...outer().querySelectorAll<HTMLElement>('.conversation-assistant-message')].find(
    (row) => row.getBoundingClientRect().bottom > outer().getBoundingClientRect().top,
  )!
  const parentTop = parentMarker.getBoundingClientRect().top
  agents.getState().open('s-1', 'child-a')
  await expect.poll(() => document.querySelector('[data-slot="agent-timeline"]')?.getAttribute('data-session-id')).toBe('child-a')
  const child = document.querySelector<HTMLElement>('[data-slot="agent-timeline"]')!
  await expect.poll(() => distance(child)).toBeLessThanOrEqual(1)
  await expect.poll(() => child.clientWidth).toBeGreaterThan(400)
  await Promise.all(
    document
      .querySelector('[data-slot="app-frame"]')!
      .getAnimations()
      .map((animation) => animation.finished),
  )
  await expect.poll(() => child.scrollHeight).toBeLessThan(5000)
  await expect.poll(() => distance(child)).toBeLessThanOrEqual(1)
  await expect.poll(() => Math.abs(parentMarker.getBoundingClientRect().top - parentTop)).toBeLessThanOrEqual(1)
  const before = child.scrollTop
  child.querySelector<HTMLButtonElement>('[data-slot="tool-card"] button')!.click()
  await expect.poll(() => child.scrollTop).toBeGreaterThan(before + 100)
  await expect.poll(() => distance(child)).toBeLessThanOrEqual(1)
  await expect.poll(() => Math.abs(parentMarker.getBoundingClientRect().top - parentTop)).toBeLessThanOrEqual(1)
  child.scrollTop = 100
  child.dispatchEvent(new Event('scroll'))
  await page.elementLocator(document.querySelector('li [data-agent-id="child-b"]')!).click()
  await expect.poll(() => document.querySelector('[data-slot="agent-timeline"]')?.getAttribute('data-session-id')).toBe('child-b')
  const other = document.querySelector<HTMLElement>('[data-slot="agent-timeline"]')!
  await expect.poll(() => distance(other)).toBeLessThanOrEqual(1)
  expect(other).not.toBe(child)
  expect(Math.abs(parentMarker.getBoundingClientRect().top - parentTop)).toBeLessThanOrEqual(1)
})

it('actual App: completion folds real process geometry on one 160ms clock and leaves no tail reservation or second landing', async () => {
  await page.viewport(1000, 800)
  const fixture = await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    ...longReplies(),
    ...Array.from({ length: 24 }, (_, i) => call(18 + i, `fold-${i}`, 'custom', {})),
  ])
  const seat = document.querySelector<HTMLElement>('[data-slot="process-seat"]')!
  const height = seat.getBoundingClientRect().height
  expect(height).toBeGreaterThan(500)
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: entry(42, 'run_end', { status: 'completed' }) })
  await expect.poll(() => seat.getAnimations().length).toBeGreaterThan(0)
  const animation = seat.getAnimations()[0]!
  animation.pause()
  animation.currentTime = 100
  await new Promise(requestAnimationFrame)
  expect(seat.getBoundingClientRect().height).toBeGreaterThan(0)
  expect(seat.getBoundingClientRect().height).toBeLessThan(height - 50)
  expect(animation.effect!.getTiming().duration).toBe(160)
  animation.finish()
  await expect.poll(() => seat.hidden).toBe(true)
  await expect.poll(() => distance(outer())).toBeLessThanOrEqual(1)
  const landed = outer().scrollTop
  await new Promise(requestAnimationFrame)
  expect(outer().scrollTop).toBe(landed)
  const visibleRows = [...document.querySelector<HTMLElement>('[data-slot="process-timeline"]')!.children].filter(
    (row) => row.getBoundingClientRect().height > 1 && row.closest('[hidden]') === null,
  )
  const lastVisible = visibleRows.at(-1)!
  expect(outer().getBoundingClientRect().bottom - lastVisible.getBoundingClientRect().bottom).toBeLessThan(20)
})

it('actual App: folding offscreen process rows preserves the visible answer while a reading gesture interrupts tail follow', async () => {
  await page.viewport(1000, 800)
  const fixture = await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    ...Array.from({ length: 24 }, (_, i) => call(2 + i, `above-${i}`, 'custom', {})),
    ...longReplies().map((record) => ({ ...record, seq: record.seq + 30 })),
  ])
  const scroller = outer()
  await expect.poll(() => distance(scroller)).toBeLessThanOrEqual(1)
  scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, bubbles: true }))
  scroller.scrollTop -= 400
  scroller.dispatchEvent(new Event('scroll'))
  const marker = [...scroller.querySelectorAll<HTMLElement>('.conversation-assistant-message')].find(
    (row) => row.getBoundingClientRect().bottom > scroller.getBoundingClientRect().top,
  )!
  const top = marker.getBoundingClientRect().top
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: entry(60, 'run_end', { status: 'completed' }) })
  const seat = scroller.querySelector<HTMLElement>('[data-slot="process-seat"]')!
  await expect.poll(() => seat.hidden).toBe(true)
  expect(Math.abs(marker.getBoundingClientRect().top - top)).toBeLessThanOrEqual(1)
  expect(distance(scroller)).toBeGreaterThan(100)
})

it('actual App: reduced motion completes the fold immediately with a correct tail and keyboard focus', async () => {
  await page.viewport(1000, 800)
  const original = window.matchMedia.bind(window)
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => {
    const result = original(query)
    if (query === '(prefers-reduced-motion: reduce)') Object.defineProperty(result, 'matches', { value: true })
    return result
  })
  await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    ...longReplies(),
    call(18, 'reduced', 'custom', {}),
    result(19, 'reduced', 'Real result'),
    entry(20, 'run_end', { status: 'completed' }),
  ])
  const whole = page.getByRole('button', { name: 'Work steps', exact: true })
  await whole.click()
  await page.getByRole('button', { name: 'Called tools', exact: true }).click()
  const tool = document.querySelector<HTMLButtonElement>('[data-slot="tool-card"] button')!
  tool.focus({ preventScroll: true })
  await whole.click()
  const seat = document.querySelector<HTMLElement>('[data-slot="process-seat"]')!
  expect(seat.hidden).toBe(true)
  expect(seat.getAnimations()).toHaveLength(0)
  expect(document.activeElement).toBe(whole.element())
  await expect.poll(() => distance(outer())).toBeLessThanOrEqual(1)
})

it('actual App: an earlier process snapshot retains the inner visible tool and its open detail, then truthful mid-process input removes whole folding', async () => {
  await page.viewport(1000, 800)
  const records = [
    entry(1, 'run_start', { trigger: 'submit' }),
    ...Array.from({ length: 24 }, (_, i) => [
      call(100 + i * 2, `retained-${i}`, 'custom', { original: i }),
      result(101 + i * 2, `retained-${i}`, `Original output ${i}`),
    ]).flat(),
    reply(148, 'Final retained answer'),
    entry(149, 'run_end', { status: 'completed' }),
  ]
  const fixture = await open(records)
  await page.getByRole('button', { name: 'Work steps', exact: true }).click()
  await page.getByRole('button', { name: 'Called tools', exact: true }).click()
  const group = document.querySelector<HTMLElement>('[data-slot="process-group-body"]')!
  await expect.poll(() => group.clientHeight).toBe(400)
  await expect.poll(() => getComputedStyle(group).overflowY).toBe('auto')
  const tool = group.querySelectorAll<HTMLElement>('[data-slot="tool-card"]')[8]!
  tool.querySelector<HTMLButtonElement>('button')!.click()
  await expect.poll(() => tool.querySelector('[data-slot="tool-card-body"]')).not.toBeNull()
  const detail = tool.querySelector('[data-slot="tool-card-body"]')!
  group.scrollTop = tool.offsetTop - group.offsetTop
  group.dispatchEvent(new Event('scroll'))
  const top = tool.getBoundingClientRect().top
  const replace = (records: SessionEntryRecord[]) =>
    fixture.chat.setState((state) => ({
      conversations: {
        ...state.conversations,
        's-1': { ...state.conversations['s-1']!, entries: records.filter((record): record is SessionEntry => Value.Check(SessionEntry, record)) },
      },
    }))
  replace([records[0]!, call(50, 'earlier', 'custom', {}), result(51, 'earlier', 'Earlier recorded output'), ...records.slice(1)])
  await expect.poll(() => group.querySelectorAll('[data-slot="tool-card"]').length).toBe(25)
  expect(Math.abs(tool.getBoundingClientRect().top - top)).toBeLessThanOrEqual(1)
  expect(tool.querySelector('[data-slot="tool-card-body"]')).toBe(detail)
  // Earlier history can reveal a real input; its position and fold eligibility follow recorded sequence.
  replace([
    records[0]!,
    call(50, 'earlier', 'custom', {}),
    result(51, 'earlier', 'Earlier recorded output'),
    entry(60, 'message', { role: 'user', content: 'Recorded mid-process instruction', timestamp: 0 }),
    ...records.slice(1),
  ])
  await expect.element(page.getByRole('button', { name: 'Work steps', exact: true })).toBeDisabled()
  await expect.element(page.getByText('Recorded mid-process instruction', { exact: true })).toBeVisible()
  expect(tool.querySelector('[data-slot="tool-card-body"]')).toBe(detail)
})

it('actual App: pausing and continuing with a new Run retain the held answer until the reader explicitly returns to the tail', async () => {
  await page.viewport(1000, 800)
  const fixture = await open([entry(1, 'run_start', { trigger: 'submit' }), ...longReplies(), call(18, 'pause-step', 'custom', {})])
  await expect.poll(() => distance(outer())).toBeLessThanOrEqual(1)
  outer().scrollTop = 400
  outer().dispatchEvent(new Event('scroll'))
  const marker = [...outer().querySelectorAll<HTMLElement>('.conversation-assistant-message')].find(
    (row) => row.getBoundingClientRect().bottom > outer().getBoundingClientRect().top,
  )!
  const top = marker.getBoundingClientRect().top
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: entry(19, 'run_end', { status: 'paused' }) })
  await expect.poll(() => document.querySelector('[data-run-status="paused"]')).not.toBeNull()
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: { ...entry(20, 'run_start', { trigger: 'continue' }), runId: 'resumed' } })
  fixture.sendServer({ type: 'progress', sessionId: 's-1', runId: 'resumed', event: { type: 'run_start' } })
  fixture.sendServer({
    type: 'entry',
    sessionId: 's-1',
    entry: { ...reply(21, 'Resumed original output\n\n' + 'Continued answer. '.repeat(100)), runId: 'resumed' },
  })
  await expect.element(page.getByText(/Resumed original output/)).toBeInTheDocument()
  expect(Math.abs(marker.getBoundingClientRect().top - top)).toBeLessThanOrEqual(1)
  await page.getByRole('button', { name: 'Return to bottom', exact: true }).click()
  await expect.poll(() => distance(outer())).toBeLessThanOrEqual(1)
})

it('actual App: restoring a focused group animates the historical header and cap together without hiding its focused tool', async () => {
  await page.viewport(1000, 800)
  const fixture = await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    ...Array.from({ length: 24 }, (_, i) => call(2 + i, `cap-motion-${i}`, 'custom', {})),
  ])
  const tool = document.querySelector<HTMLButtonElement>('[data-slot="tool-card"] button')!
  tool.focus({ preventScroll: true })
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: entry(26, 'run_end', { status: 'completed' }) })
  const header = document.querySelector<HTMLElement>('[data-slot="process-group-header"]')!
  await expect.poll(() => header.parentElement!.getAnimations().length).toBeGreaterThan(0)
  const animation = header.parentElement!.getAnimations()[0]!
  animation.pause()
  animation.currentTime = 80
  await new Promise(requestAnimationFrame)
  expect(header.parentElement!.getBoundingClientRect().height).toBeGreaterThan(0)
  expect(header.parentElement!.getBoundingClientRect().height).toBeLessThan(32)
  animation.finish()
  await animation.finished
  await expect.poll(() => header.parentElement!.getAnimations().length).toBe(0)
  expect(header.getBoundingClientRect().height).toBe(32)
  expect(document.activeElement).toBe(tool)
  expect(tool.closest('[hidden]')).toBeNull()
  const group = document.querySelector<HTMLElement>('[data-slot="process-group-body"]')!
  await expect.poll(() => group.clientHeight).toBe(400)
  expect(group.scrollTop).toBe(0)
})

it('actual App: reversing a manual fold continues from the displayed height and retains the mounted process seat', async () => {
  await page.viewport(1000, 800)
  await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    ...Array.from({ length: 24 }, (_, i) => call(2 + i, `reverse-${i}`, 'custom', {})),
    entry(26, 'run_end', { status: 'completed' }),
  ])
  const whole = page.getByRole('button', { name: 'Work steps', exact: true })
  await whole.click()
  await page.getByRole('button', { name: 'Called tools', exact: true }).click()
  const group = document.querySelector<HTMLElement>('[data-slot="process-group-body"]')!
  await expect.poll(() => getComputedStyle(group).overflowY).toBe('auto')
  const seat = document.querySelector<HTMLElement>('[data-slot="process-seat"]')!
  await whole.click()
  const closing = seat.getAnimations()[0]!
  closing.pause()
  closing.currentTime = 100
  await new Promise(requestAnimationFrame)
  const mid = seat.getBoundingClientRect().height
  expect(mid).toBeGreaterThan(30)
  await whole.click()
  await expect.poll(() => seat.getAnimations()[0] !== closing).toBe(true)
  const opening = seat.getAnimations()[0]!
  opening.pause()
  opening.currentTime = 0
  await new Promise(requestAnimationFrame)
  expect(Math.abs(seat.getBoundingClientRect().height - mid)).toBeLessThanOrEqual(1)
  opening.finish()
  await expect.poll(() => seat.getAnimations().length).toBe(0)
  expect(document.querySelector('[data-slot="process-seat"]')).toBe(seat)
  expect(seat.hidden).toBe(false)
})

it('actual App: keyboard Space opens detail at the tail and a downward wheel at the floor retains following', async () => {
  await page.viewport(1000, 800)
  const fixture = await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    ...longReplies(),
    call(18, 'keyboard-growth', 'custom', {}),
    result(19, 'keyboard-growth', 'Real keyboard output\n'.repeat(60)),
  ])
  await expect.poll(() => distance(outer())).toBeLessThanOrEqual(1)
  const header = document.querySelector<HTMLButtonElement>('[data-slot="tool-card"] button')!
  header.focus({ preventScroll: true })
  await userEvent.keyboard(' ')
  await expect.poll(() => document.querySelector('[data-slot="tool-card-body"]')).not.toBeNull()
  await expect.poll(() => distance(outer())).toBeLessThanOrEqual(1)
  outer().dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true }))
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: reply(20, 'Tail after downward gesture.\n\n' + 'Actual paragraph. '.repeat(100)) })
  await expect.element(page.getByText(/Tail after downward gesture/)).toBeInTheDocument()
  await expect.poll(() => distance(outer())).toBeLessThanOrEqual(1)
  const touch = (clientY: number) => new Touch({ identifier: 1, target: outer(), clientX: 100, clientY })
  outer().dispatchEvent(new TouchEvent('touchstart', { touches: [touch(200)], bubbles: true }))
  outer().dispatchEvent(new TouchEvent('touchmove', { touches: [touch(150)], bubbles: true }))
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: reply(21, 'Tail after downward touch.\n\n' + 'Next actual paragraph. '.repeat(100)) })
  await expect.element(page.getByText(/Tail after downward touch/)).toBeInTheDocument()
  await expect.poll(() => distance(outer())).toBeLessThanOrEqual(1)
})

it('actual App: an upward reading gesture during an active completion fold interrupts tail follow and retains the answer anchor', async () => {
  await page.viewport(1000, 800)
  const fixture = await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    ...Array.from({ length: 24 }, (_, i) => call(2 + i, `active-motion-${i}`, 'custom', {})),
    ...longReplies().map((record) => ({ ...record, seq: record.seq + 30 })),
  ])
  const scroller = outer()
  await expect.poll(() => distance(scroller)).toBeLessThanOrEqual(1)
  const seat = scroller.querySelector<HTMLElement>('[data-slot="process-seat"]')!
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: entry(60, 'run_end', { status: 'completed' }) })
  await expect.poll(() => seat.getAnimations().length).toBeGreaterThan(0)
  const motion = seat.getAnimations()[0]!
  motion.pause()
  motion.currentTime = 80
  await new Promise(requestAnimationFrame)
  scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, bubbles: true }))
  scroller.scrollTop -= 200
  scroller.dispatchEvent(new Event('scroll'))
  const marker = [...scroller.querySelectorAll<HTMLElement>('.conversation-assistant-message')].find(
    (row) => row.getBoundingClientRect().bottom > scroller.getBoundingClientRect().top,
  )!
  const top = marker.getBoundingClientRect().top
  motion.currentTime = 120
  await new Promise(requestAnimationFrame)
  expect(Math.abs(marker.getBoundingClientRect().top - top)).toBeLessThanOrEqual(1)
  motion.finish()
  await expect.poll(() => seat.hidden).toBe(true)
  expect(Math.abs(marker.getBoundingClientRect().top - top)).toBeLessThanOrEqual(1)
  expect(distance(scroller)).toBeGreaterThan(100)
})

it('actual App: restoring the cap keeps a focused tail tool inside the visible group and outer viewport', async () => {
  await page.viewport(1000, 800)
  const fixture = await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    ...Array.from({ length: 24 }, (_, i) => call(2 + i, `focused-tail-${i}`, 'custom', {})),
  ])
  await expect.poll(() => distance(outer())).toBeLessThanOrEqual(1)
  const tool = document.querySelectorAll<HTMLButtonElement>('[data-slot="tool-card"] button')[23]!
  tool.focus({ preventScroll: true })
  expect(tool.getBoundingClientRect().bottom).toBeLessThanOrEqual(outer().getBoundingClientRect().bottom)
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: entry(26, 'run_end', { status: 'completed' }) })
  const group = document.querySelector<HTMLElement>('[data-slot="process-group-body"]')!
  await expect.poll(() => group.getAnimations().length).toBeGreaterThan(0)
  const motion = group.getAnimations()[0]!
  motion.pause()
  motion.currentTime = 80
  await expect.poll(() => tool.getBoundingClientRect().bottom - group.getBoundingClientRect().bottom).toBeLessThanOrEqual(1)
  expect(document.activeElement).toBe(tool)
  motion.finish()
  await expect.poll(() => getComputedStyle(group).overflowY).toBe('auto')
  expect(document.activeElement).toBe(tool)
  expect(tool.getBoundingClientRect().bottom).toBeLessThanOrEqual(group.getBoundingClientRect().bottom)
  expect(tool.getBoundingClientRect().top).toBeGreaterThanOrEqual(group.getBoundingClientRect().top)
  expect(tool.getBoundingClientRect().bottom).toBeLessThanOrEqual(outer().getBoundingClientRect().bottom)
})

it('actual App: a portaled preview retains its scoped tail return target through cap restoration and Escape', async () => {
  await page.viewport(1000, 800)
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg=='
  const fixture = await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    ...Array.from({ length: 23 }, (_, i) => call(2 + i, `portal-prefix-${i}`, 'custom', {})),
    call(25, 'portal-tail', 'mcp__playwright__screenshot', {}),
    entry(26, 'message', {
      role: 'toolResult',
      toolCallId: 'portal-tail',
      toolName: 'mcp__playwright__screenshot',
      content: [{ type: 'image', data: png, mimeType: 'image/png' }],
      isError: false,
      timestamp: 0,
    }),
  ])
  await expect.poll(() => distance(outer())).toBeLessThanOrEqual(1)
  const tool = document.querySelectorAll<HTMLButtonElement>('[data-slot="tool-card"] > button')[23]!
  tool.click()
  const preview = page.getByRole('button', { name: /View full size:/ })
  await preview.click()
  await expect.element(page.getByRole('dialog')).toBeVisible()
  const target = document.querySelector<HTMLElement>('[data-tool-image-preview-open]')!
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: entry(27, 'run_end', { status: 'completed' }) })
  const group = document.querySelector<HTMLElement>('[data-slot="process-group-body"]')!
  await expect.poll(() => getComputedStyle(group).overflowY).toBe('auto')
  expect(target.getBoundingClientRect().bottom).toBeLessThanOrEqual(group.getBoundingClientRect().bottom)
  expect(target.getBoundingClientRect().top).toBeGreaterThanOrEqual(group.getBoundingClientRect().top)
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  expect(document.activeElement).toBe(target)
  expect(target.getBoundingClientRect().bottom).toBeLessThanOrEqual(outer().getBoundingClientRect().bottom)
})

it('actual App: cap restoration keeps a focused code action visible inside a reasoning row taller than the cap', async () => {
  await page.viewport(1000, 800)
  const thinking = 'Original reasoning\n\n' + 'Retained reasoning paragraph.\n\n'.repeat(50) + '```text\nOriginal code content\n```'
  const fixture = await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    entry(2, 'message', { role: 'assistant', content: [{ type: 'thinking', thinking }], stopReason: 'toolUse', timestamp: 0 }),
  ])
  await page.getByRole('button', { name: 'Thinking', exact: true }).click()
  await expect.poll(() => document.querySelectorAll('.conversation-reasoning-body [data-streamdown="code-block-actions"] button').length).toBeGreaterThan(0)
  await expect.poll(() => distance(outer())).toBeLessThanOrEqual(1)
  const action = [...document.querySelectorAll<HTMLButtonElement>('.conversation-reasoning-body [data-streamdown="code-block-actions"] button')].at(-1)!
  action.focus({ preventScroll: true })
  expect(action.getBoundingClientRect().bottom).toBeLessThanOrEqual(outer().getBoundingClientRect().bottom)
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: entry(3, 'run_end', { status: 'completed' }) })
  const group = document.querySelector<HTMLElement>('[data-slot="process-group-body"]')!
  await expect.poll(() => getComputedStyle(group).overflowY).toBe('auto')
  expect(document.activeElement).toBe(action)
  expect(action.getBoundingClientRect().bottom).toBeLessThanOrEqual(group.getBoundingClientRect().bottom)
  expect(action.getBoundingClientRect().top).toBeGreaterThanOrEqual(group.getBoundingClientRect().top)
})

it('actual App: the focused sticky thinking control remains in the outer viewport throughout cap restoration', async () => {
  await page.viewport(1000, 800)
  const thinking = 'Original thinking\n\n' + 'Retained reasoning paragraph.\n\n'.repeat(50)
  const fixture = await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    entry(2, 'message', { role: 'assistant', content: [{ type: 'thinking', thinking }], stopReason: 'toolUse', timestamp: 0 }),
  ])
  const toggle = page.getByRole('button', { name: 'Thinking', exact: true })
  await toggle.click()
  await expect.poll(() => distance(outer())).toBeLessThanOrEqual(1)
  expect(toggle.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(outer().getBoundingClientRect().top)
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: entry(3, 'run_end', { status: 'completed' }) })
  const group = document.querySelector<HTMLElement>('[data-slot="process-group-body"]')!
  await expect.poll(() => group.getAnimations().length).toBeGreaterThan(0)
  const motion = group.getAnimations()[0]!
  motion.pause()
  motion.currentTime = 20
  await expect.poll(() => toggle.element().getBoundingClientRect().top - outer().getBoundingClientRect().top).toBeGreaterThanOrEqual(0)
  expect(document.activeElement).toBe(toggle.element())
  motion.finish()
  await expect.poll(() => getComputedStyle(group).overflowY).toBe('auto')
  expect(toggle.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(outer().getBoundingClientRect().top)
})
