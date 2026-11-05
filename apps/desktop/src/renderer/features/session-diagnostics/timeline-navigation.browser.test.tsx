import '../../styles.css'
import { SessionEntry, type SessionEntryRecord } from '@coko/protocol'
import { Value } from 'typebox/value'
import { expect, it, onTestFinished } from 'vitest'
import { setReducedMotion } from '../../testing/browser-commands.ts'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { createFixtureChat, fixtureSessions } from '../../testing/fixture-chat.ts'

const entry = (seq: number, kind: string, payload: unknown, runId: string | null = 'run-a'): SessionEntryRecord => ({
  sessionId: 's-1',
  seq,
  kind,
  payloadVersion: 1,
  createdAt: 1_700_000_000_000 + seq,
  runId: runId ?? null,
  payload,
})
const records = [
  entry(1, 'run_start', { trigger: 'submit' }),
  entry(3, 'message', { role: 'user', content: 'user literal token and [REDACTED:secret]', timestamp: 0 }),
  entry(5, 'run_end', { status: 'completed' }),
]
async function open(entries = records, options: { width?: number; locale?: 'en' | 'zh'; theme?: 'light' | 'dark'; archived?: boolean } = {}) {
  await page.viewport(options.width ?? 1280, 800)
  const fixture = createFixtureChat({
    entries: { 's-1': entries },
    ...(options.archived ? { sessions: fixtureSessions.map((session) => (session.id === 's-1' ? { ...session, archivedAt: 1 } : session)) } : {}),
  })
  fixture.backend.externalWrite('developer', { sessionDiagnostics: true })
  await fixture.settings.getState().load()
  const appearance = createAppearanceStore({ locale: options.locale ?? 'en', theme: options.theme ?? 'light' })
  const preferences = createPreferences({ appearance, settings: fixture.settings, onConflict() {}, onFailure() {} })
  const settingsPage = createSettingsPageStore()
  await render(
    <div style={{ width: '100vw', height: '100vh' }}>
      <App
        store={appearance}
        connection={createConnectionStore()}
        chat={fixture.chat}
        settings={fixture.settings}
        preferences={preferences}
        settingsPage={settingsPage}
        pickDirectory={async () => null}
      />
    </div>,
  )
  if (options.archived) {
    settingsPage.open('archived')
    await page.getByRole('button', { name: options.locale === 'zh' ? '打开对话' : 'Open conversation', exact: true }).click()
  }
  await expect.poll(() => fixture.chat.getState().conversations['s-1']?.status).toBe('ready')
  await page.getByRole('button', { name: options.locale === 'zh' ? '打开侧边栏' : 'Open sidebar', exact: true }).click()
  const panel = page.getByRole('region', { name: options.locale === 'zh' ? '侧边栏' : 'Sidebar', exact: true })
  await panel.getByRole('button', { name: options.locale === 'zh' ? '会话数据诊断' : 'Session diagnostics', exact: true }).click()
  return { ...fixture, panel }
}

const processRecords = [
  entry(1, 'run_start', { trigger: 'submit' }),
  entry(2, 'message', { role: 'user', content: 'Inspect process', timestamp: 0 }),
  entry(3, 'message', {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'Hidden reasoning' },
      { type: 'toolCall', id: 'read-a', name: 'read', arguments: { path: '/test.txt' } },
    ],
    stopReason: 'toolUse',
    timestamp: 0,
  }),
  entry(4, 'message', {
    role: 'toolResult',
    toolCallId: 'read-a',
    toolName: 'read',
    content: [{ type: 'text', text: 'Found contents' }],
    isError: false,
    timestamp: 0,
  }),
  entry(5, 'message', { role: 'assistant', content: [{ type: 'text', text: 'Finished' }], stopReason: 'stop', timestamp: 0 }),
  entry(6, 'run_end', { status: 'completed' }),
]
async function grouping(panel: ReturnType<typeof page.getByRole>) {
  await panel.getByRole('button', { name: 'Display format', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Conversation groups', exact: true }).click()
}

it('actual App locates a tool result through whole Run, group and tool disclosures without changing timeline nodes', async () => {
  const { panel } = await open(processRecords)
  const tool = document.querySelector<HTMLElement>('[data-tool-call-id="read-a"]')!
  const scroll = document.querySelector<HTMLElement>('.conversation-message-scroll')!
  const before = tool
  expect(tool.closest('[hidden]')).not.toBeNull()
  await panel.getByRole('button', { name: 'Inspect record 4', exact: true }).click()
  await expect.poll(() => tool.closest('[hidden]')).toBeNull()
  await expect.poll(() => tool.querySelector('[aria-expanded="true"]')).not.toBeNull()
  await expect.poll(() => document.querySelector('[data-slot="timeline-highlight"]')).not.toBeNull()
  expect(document.querySelector('[data-tool-call-id="read-a"]')).toBe(before)
  const position = scroll.scrollTop
  await panel.getByRole('button', { name: 'Inspect record 4', exact: true }).click()
  await expect.poll(() => scroll.scrollTop).toBeCloseTo(position, 0)
  expect(scroll.querySelector('[data-slot="timeline-highlight"]')).toBeNull()
})

it('actual App picker suppresses tool actions, reveals an excluded grouping row and starts a new breadcrumb root', async () => {
  const { panel } = await open(processRecords)
  await grouping(panel)
  const table = panel.getByRole('table')
  await table.getByRole('button', { name: 'Inspect record tool:read-a', exact: true }).click()
  const tool = document.querySelector<HTMLElement>('[data-tool-call-id="read-a"]')!
  await expect.poll(() => tool.closest('[hidden]')).toBeNull()
  const details = panel.getByRole('region', { name: 'Record details', exact: true })
  await details.getByRole('button', { name: 'Run · run-a', exact: true }).click()
  await table.getByRole('button', { name: 'Filter types', exact: true }).click()
  await page.getByRole('combobox', { name: 'Type fragment', exact: true }).fill('text')
  await page.getByRole('button', { name: 'Apply filter', exact: true }).click()
  const trigger = tool.querySelector<HTMLButtonElement>('button[aria-expanded]')!
  const expanded = trigger.getAttribute('aria-expanded')
  let underlyingClicks = 0
  const activated = () => underlyingClicks++
  trigger.addEventListener('click', activated)
  onTestFinished(() => trigger.removeEventListener('click', activated))
  await panel.getByRole('button', { name: 'Pick from timeline', exact: true }).click()
  await expect.poll(() => document.querySelector('[data-slot="timeline-mask"]')).not.toBeNull()
  await page.elementLocator(trigger).hover({ force: true })
  await expect.poll(() => document.querySelector('[data-preview]')?.getBoundingClientRect().width).toBeGreaterThan(0)
  const rect = trigger.getBoundingClientRect()
  for (const type of ['pointerdown', 'mousedown', 'auxclick', 'dblclick', 'contextmenu']) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: rect.left + 5, clientY: rect.top + 5 })
    expect(trigger.dispatchEvent(event)).toBe(false)
    expect(event.defaultPrevented).toBe(true)
  }
  await panel.getByRole('button', { name: 'Pick from timeline', exact: true }).hover()
  await expect.poll(() => document.querySelector<HTMLElement>('[data-preview]')?.hidden).toBe(true)
  await page.elementLocator(trigger).click({ force: true })
  await expect.element(table.getByRole('button', { name: 'Inspect record tool:read-a', exact: true })).toBeVisible()
  await expect.element(panel.getByRole('status', { name: 'Current row count' })).toHaveTextContent('5 rows')
  await expect.poll(() => details.getByRole('navigation', { name: 'Inspection path', exact: true }).element().textContent).toBe('tool:read-a')
  expect(trigger.getAttribute('aria-expanded')).toBe(expanded)
  expect(underlyingClicks).toBe(0)
  expect(document.querySelector('[data-slot="timeline-mask"]')).toBeNull()
})

it('actual App picker stays waiting after a miss and cancels on Escape, toggle, blur, format, hide, close and Session change', async () => {
  const { panel, chat } = await open(processRecords)
  const pick = () => panel.getByRole('button', { name: 'Pick from timeline', exact: true })
  const start = async () => {
    await pick().click()
    await expect.poll(() => document.querySelector('[data-slot="timeline-mask"]')).not.toBeNull()
  }
  const stopped = async () => {
    await expect.poll(() => document.querySelector('[data-slot="timeline-mask"]')).toBeNull()
    expect(document.querySelector('[data-preview]')).toBeNull()
  }
  await start()
  await page.elementLocator(document.querySelector('[data-slot="timeline-mask"]')!).click({ position: { x: 1, y: 1 } })
  await expect
    .element(panel.getByText('No matching record in the current table. Choose another element or press Esc to cancel.', { exact: true }))
    .toBeVisible()
  await expect.element(pick()).toHaveAttribute('aria-pressed', 'true')
  await userEvent.keyboard('{Escape}')
  await stopped()
  await start()
  await pick().click()
  await stopped()
  await start()
  window.dispatchEvent(new Event('blur'))
  await stopped()
  await start()
  await grouping(panel)
  await stopped()
  await start()
  await panel.getByRole('button', { name: 'Fullscreen', exact: true }).click()
  await stopped()
  await pick().click()
  await expect.element(pick()).toHaveAttribute('aria-pressed', 'false')
  expect(document.querySelector('[data-slot="timeline-mask"]')).toBeNull()
  await panel.getByRole('button', { name: 'Exit fullscreen', exact: true }).click()
  await start()
  await panel.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  await stopped()
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  await start()
  await panel.getByRole('button', { name: 'Close Session diagnostics', exact: true }).click()
  await stopped()
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  await panel.getByRole('button', { name: 'Session diagnostics', exact: true }).click()
  await start()
  chat.getState().openSession('s-2')
  await stopped()
})

it('actual App reduced-motion reveal scrolls immediately without timeline or table flashes and retains the new reading position', async () => {
  await setReducedMotion(true)
  onTestFinished(() => setReducedMotion(false))
  const initial = [
    ...processRecords.filter((entry) => entry.seq !== 2),
    ...Array.from({ length: 35 }, (_, index) => entry(index + 10, 'message', { role: 'user', content: `Later user ${index}\n`.repeat(5), timestamp: 0 })),
  ]
  const { panel, chat } = await open(initial)
  const scroll = document.querySelector<HTMLElement>('.conversation-message-scroll')!
  await expect.poll(() => scroll.scrollTop).toBeGreaterThan(500)
  const rawScroll = panel.element().querySelector<HTMLElement>('[data-slot="diagnostic-scroll"]')!
  rawScroll.scrollTop = 0
  rawScroll.dispatchEvent(new Event('scroll'))
  await panel.getByRole('button', { name: 'Inspect record 4', exact: true }).click()
  const tool = document.querySelector<HTMLElement>('[data-tool-call-id="read-a"]')!
  await expect.poll(() => tool.closest('[hidden]')).toBeNull()
  await expect.poll(() => tool.getBoundingClientRect().top).toBeGreaterThanOrEqual(scroll.getBoundingClientRect().top - 1)
  expect(tool.getBoundingClientRect().top).toBeLessThan(scroll.getBoundingClientRect().bottom)
  expect(document.querySelector('[data-slot="timeline-highlight"]')).toBeNull()
  expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true)
  const flashes = [...rawScroll.getAnimations({ subtree: true })].filter(
    (animation) => !(animation instanceof CSSAnimation) && !(animation instanceof CSSTransition) && animation.playState === 'running',
  )
  expect(flashes).toEqual([])

  await new Promise<void>((resolve) => {
    let previous = '',
      stable = 0
    const sample = () => {
      const rect = tool.getBoundingClientRect()
      const next = `${rect.top}:${scroll.scrollTop}:${tool.closest('[hidden]')}`
      stable = next === previous && !scroll.querySelector('[data-flow-motion]') ? stable + 1 : 0
      previous = next
      if (stable >= 4) resolve()
      else requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  const top = tool.getBoundingClientRect().top
  const earlier = entry(2, 'message', { role: 'user', content: 'Earlier insertion\n'.repeat(8), timestamp: 0 })
  chat.setState((state) => ({
    conversations: {
      ...state.conversations,
      's-1': {
        ...state.conversations['s-1']!,
        entries: [...initial, earlier].sort((a, b) => a.seq - b.seq).filter((record): record is SessionEntry => Value.Check(SessionEntry, record)),
      },
    },
  }))
  await expect.element(page.getByText('Earlier insertion', { exact: false }).first()).toBeInTheDocument()
  await expect.poll(() => tool.getBoundingClientRect().top).toBeCloseTo(top, 0)
})

it('actual App reveals a late nested tool, clips body paint and forwards wheel to the inner reader before the outer column', async () => {
  const source = [
    entry(1, 'run_start', { trigger: 'submit' }),
    ...Array.from({ length: 22 }, (_, index) => [
      entry(2 + index * 2, 'message', {
        role: 'assistant',
        content: [{ type: 'toolCall', id: `many-${index}`, name: 'custom', arguments: {} }],
        stopReason: 'toolUse',
        timestamp: 0,
      }),
      entry(3 + index * 2, 'message', {
        role: 'toolResult',
        toolCallId: `many-${index}`,
        toolName: 'custom',
        content: [{ type: 'text', text: `Result ${index}` }],
        isError: false,
        timestamp: 0,
      }),
    ]).flat(),
    entry(46, 'message', { role: 'assistant', content: [{ type: 'text', text: 'All done' }], stopReason: 'stop', timestamp: 0 }),
    entry(47, 'run_end', { status: 'completed' }),
  ]
  const { panel } = await open(source)
  const tablePort = panel.element().querySelector<HTMLElement>('[data-slot="diagnostic-scroll"]')!
  tablePort.scrollTop = 950
  tablePort.dispatchEvent(new Event('scroll'))
  await panel.getByRole('button', { name: 'Inspect record 39', exact: true }).click()
  const tool = document.querySelector<HTMLElement>('[data-tool-call-id="many-18"]')!
  const group = tool.closest<HTMLElement>('[data-slot="process-group-body"]')!
  const outer = document.querySelector<HTMLElement>('.conversation-message-scroll')!
  await expect.poll(() => group.scrollTop).toBeGreaterThan(100)
  await expect.poll(() => document.querySelector('[data-slot="timeline-highlight"]')).not.toBeNull()
  const highlight = document.querySelector<HTMLElement>('[data-slot="timeline-highlight"]')!.getBoundingClientRect()
  expect(highlight.top).toBeGreaterThanOrEqual(Math.max(group.getBoundingClientRect().top, outer.getBoundingClientRect().top) - 1)
  expect(highlight.bottom).toBeLessThanOrEqual(Math.min(group.getBoundingClientRect().bottom, outer.getBoundingClientRect().bottom) + 1)
  const innerTop = group.scrollTop,
    outerTop = outer.scrollTop
  await panel.getByRole('button', { name: 'Pick from timeline', exact: true }).click()
  const mask = document.querySelector<HTMLElement>('[data-slot="timeline-mask"]')!
  const rect = tool.getBoundingClientRect()
  mask.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: rect.left + 10, clientY: rect.top + 10, deltaY: -70 }))
  await expect.poll(() => group.scrollTop).toBeCloseTo(innerTop - 70, 0)
  expect(outer.scrollTop).toBe(outerTop)
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => document.querySelector('[data-slot="timeline-mask"]')).toBeNull()
})

it('actual App reveals same-Session rewound and command native details through the current main owner', async () => {
  const { panel } = await open([
    ...processRecords,
    entry(7, 'rewind', { targetSeq: 2 }, null),
    entry(8, 'run_start', { trigger: 'submit' }, 'current'),
    entry(9, 'command', { name: 'review', args: 'src', source: 'project' }, 'current'),
    entry(10, 'message', { role: 'user', content: 'Expanded command instruction', timestamp: 0 }, 'current'),
    entry(11, 'run_end', { status: 'completed' }, 'current'),
  ])
  const history = document.querySelector<HTMLDetailsElement>('[data-slot="rewound"]')!
  expect(history.open).toBe(false)
  await panel.getByRole('button', { name: 'Inspect record 4', exact: true }).click()
  const tool = history.querySelector<HTMLElement>('[data-tool-call-id="read-a"]')!
  await expect.poll(() => history.open).toBe(true)
  await expect.poll(() => tool.closest('[hidden]')).toBeNull()
  await expect.poll(() => tool.querySelector('[aria-expanded="true"]')).not.toBeNull()
  expect(document.querySelector('[data-slot="app-frame-main"] [data-slot="user-message"]')?.textContent).toContain('Inspect process')
  const command = document.querySelector<HTMLDetailsElement>('[data-slot="command-message"]')!
  expect(command.open).toBe(false)
  await panel.getByRole('button', { name: 'Inspect record 10', exact: true }).click()
  await expect.poll(() => command.open).toBe(true)
})

it('actual App falls back to loaded content and finally paints the visible column without scrolling', async () => {
  const { panel } = await open([entry(1, 'file_backup', { anchorSeq: 1, path: '/test.txt', absent: true }, null)])
  const port = document.querySelector<HTMLElement>('.conversation-message-scroll')!
  const top = port.scrollTop
  await panel.getByRole('button', { name: 'Inspect record 1', exact: true }).click()
  await expect.poll(() => document.querySelector('[data-slot="timeline-highlight"]')).not.toBeNull()
  const paint = document.querySelector<HTMLElement>('[data-slot="timeline-highlight"]')!.getBoundingClientRect()
  const viewport = port.getBoundingClientRect()
  expect(paint.top).toBeCloseTo(viewport.top, 0)
  expect(paint.bottom).toBeCloseTo(viewport.bottom, 0)
  expect(port.scrollTop).toBe(top)
})

it('actual App can finish locating while another group animates and another Run keeps receiving live text', async () => {
  const other = processRecords.map((record) => ({
    ...record,
    seq: record.seq + 10,
    runId: 'other',
    payload: JSON.parse(JSON.stringify(record.payload).replaceAll('read-a', 'read-b')),
  }))
  const { panel, sendServer } = await open([...processRecords, ...other, entry(20, 'run_start', { trigger: 'submit' }, 'live')])
  const otherGroup = document.querySelector<HTMLElement>('[data-process-group-id][data-run-id="other"]')!
  const runControls = document.querySelectorAll<HTMLButtonElement>('[data-slot="run-process-control"]')
  runControls[1]!.click()
  await expect.poll(() => otherGroup.closest('[hidden]')).toBeNull()
  let frame = 0,
    updates = 0
  const pump = () => {
    otherGroup.querySelector<HTMLButtonElement>('[data-slot="process-group-header"]')!.click()
    sendServer({
      type: 'progress',
      sessionId: 's-1',
      runId: 'live',
      event: { type: 'assistant_delta', contentIndex: 0, kind: 'text', delta: 'live ', offset: updates * 5 },
    })
    updates++
    frame = requestAnimationFrame(pump)
  }
  onTestFinished(() => cancelAnimationFrame(frame))
  frame = requestAnimationFrame(pump)
  await panel.getByRole('button', { name: 'Inspect record 4', exact: true }).click()
  await expect.poll(() => document.querySelector('[data-slot="timeline-highlight"]')).not.toBeNull()
  expect(updates).toBeGreaterThan(1)
  expect(otherGroup.querySelector('[data-flow-motion]')).not.toBeNull()
  cancelAnimationFrame(frame)
})

it('actual App live raw progress uses the mounted content-block identity for precise selection and picking', async () => {
  const { panel, sendServer } = await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    entry(2, 'message', { role: 'user', content: 'Generate', timestamp: 0 }),
  ])
  const progress = (event: Parameters<typeof sendServer>[0] & { type: 'progress' }) => sendServer(event)
  progress({ type: 'progress', sessionId: 's-1', runId: 'run-a', event: { type: 'run_start' } })
  progress({
    type: 'progress',
    sessionId: 's-1',
    runId: 'run-a',
    event: { type: 'assistant_delta', contentIndex: 0, kind: 'thinking', delta: 'Live private reasoning', offset: 0 },
  })
  await panel.getByRole('button', { name: 'assistant_delta/thinking', exact: true }).click()
  const thinking = document.querySelector<HTMLElement>('[data-slot="reasoning"]')!
  await expect.poll(() => thinking.dataset.expanded).toBe('true')
  await expect.poll(() => document.querySelector('[data-slot="timeline-highlight"]')).not.toBeNull()
  await panel.getByRole('button', { name: 'Close details', exact: true }).click()
  await panel.getByRole('button', { name: 'Pick from timeline', exact: true }).click()
  await page.elementLocator(thinking.querySelector('button')!).click({ force: true })
  const selected = panel.element().querySelector('[data-record-key][aria-selected="true"]')!
  expect(selected.textContent).toContain('assistant_delta/thinking')
  await expect.element(panel.getByRole('region', { name: 'Record details', exact: true })).toBeVisible()
})

it('actual App missing Entry targets fall back to the nearest same Run, then another loaded Run, without navigation', async () => {
  const { panel, chat } = await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    entry(2, 'file_backup', { anchorSeq: 3, path: '/a', absent: true }),
    entry(3, 'message', { role: 'user', content: 'Same Run candidate', timestamp: 0 }),
    entry(4, 'run_end', { status: 'completed' }),
    entry(6, 'message', { role: 'user', content: 'Other Run candidate', timestamp: 0 }, 'other'),
    entry(7, 'file_backup', { anchorSeq: 6, path: '/b', absent: true }, 'unrendered'),
  ])
  const same = document.querySelector<HTMLElement>('[data-timeline-identity][data-entry-seq="3"]')!
  const other = document.querySelector<HTMLElement>('[data-timeline-identity][data-entry-seq="6"]')!
  const paintedAt = (element: HTMLElement) => {
    const rect = document.querySelector<HTMLElement>('[data-slot="timeline-highlight"]')?.getBoundingClientRect()
    return rect ? Math.abs(rect.top - element.getBoundingClientRect().top) : Infinity
  }
  await panel.getByRole('button', { name: 'Inspect record 2', exact: true }).click()
  await expect.poll(() => paintedAt(same)).toBeLessThan(1)
  await panel.getByRole('button', { name: 'Inspect record 7', exact: true }).click()
  await expect.poll(() => paintedAt(other)).toBeLessThan(1)
  expect(chat.getState().activeSessionId).toBe('s-1')
  await expect.element(panel.getByRole('heading', { name: 'Session diagnostics', exact: true })).toBeVisible()
})
