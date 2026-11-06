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
import { createFixtureChat } from '../../testing/fixture-chat.ts'

let viewport = { width: 0, height: 0 }
beforeEach(() => {
  viewport = { width: window.innerWidth, height: window.innerHeight }
})
afterEach(async () => {
  await page.viewport(viewport.width, viewport.height)
})

function history(count = 4): SessionEntryRecord[] {
  const entries: SessionEntryRecord[] = []
  const add = (runId: string, kind: string, payload: unknown) =>
    entries.push({ sessionId: 's-1', seq: entries.length + 1, kind, payloadVersion: 1, payload, runId, createdAt: entries.length * 1000 })
  for (let i = 1; i <= count; i++) {
    const run = `detail-${i}`
    add(run, 'run_start', { trigger: 'submit' })
    add(run, 'message', { role: 'user', content: `Question ${i}: inspect the built-in tools`, timestamp: 0 })
    add(run, 'message', {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Inspect the project and locate the tool definitions.' },
        { type: 'toolCall', id: `command-${i}`, name: 'bash', arguments: { command: 'ls packages/agent/src/tools', description: 'Inspect tool registry' } },
        { type: 'toolCall', id: `search-${i}`, name: 'grep', arguments: { pattern: 'registerTool' } },
      ],
      stopReason: 'toolUse',
      timestamp: 0,
    })
    for (const name of ['command', 'search'])
      add(run, 'message', {
        role: 'toolResult',
        toolCallId: `${name}-${i}`,
        toolName: name === 'command' ? 'bash' : 'grep',
        content: [{ type: 'text', text: `Recorded output ${name} ${i}` }],
        isError: false,
        timestamp: 0,
      })
    add(run, 'message', {
      role: 'assistant',
      content: [{ type: 'text', text: `Answer ${i}\n\n${'The recorded tools include file reading, code search and command execution. '.repeat(30)}` }],
      stopReason: 'stop',
      timestamp: 0,
    })
    add(run, 'run_end', { status: 'completed' })
  }
  return entries
}

async function open(theme: 'light' | 'dark' = 'light', count = 4, entries = history(count)) {
  const fixture = createFixtureChat({ entries: { 's-1': entries } })
  const appearance = createAppearanceStore({ theme, locale: 'en' })
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

it.each(['light', 'dark'] as const)('actual App: %s details separate thought and call groups, with nested operations and retained expansion', async (theme) => {
  await page.viewport(1600, 1000)
  await open(theme)
  const controls = document.querySelectorAll<HTMLButtonElement>('[data-slot="run-process-control"]')
  controls[3]!.click()
  const group = document.querySelectorAll<HTMLElement>('[data-slot="process-group"]')[3]!
  group.querySelector<HTMLButtonElement>('[data-slot="process-group-header"]')!.click()
  const batch = group.querySelector<HTMLElement>('[data-slot="process-tool-step"]')!
  expect(batch.querySelector('button')!.textContent).toBe('Code·Inspect tool registry')
  const thought = group.querySelector<HTMLElement>('.conversation-reasoning')!
  const row = batch.querySelector<HTMLElement>('[data-slot="tool-card"]')!
  await expect.element(page.elementLocator(row)).toBeVisible()
  expect(batch.querySelectorAll('[data-slot="tool-card"]')).toHaveLength(2)
  expect(Math.round(row.getBoundingClientRect().left - thought.getBoundingClientRect().left)).toBe(31)
  const callButton = row.querySelector<HTMLButtonElement>('button')!
  callButton.click()
  await expect.element(page.getByText('Recorded output command 4', { exact: true })).toBeVisible()
  const header = batch.querySelector<HTMLButtonElement>('button')!
  header.click()
  await expect.element(page.elementLocator(row)).not.toBeVisible()
  header.click()
  expect(batch.querySelector('[data-slot="tool-card-body"]')).not.toBeNull()
  expect(row.querySelector('button')).toBe(callButton)
})

it('actual App: left turn marks preview and jump, tracking the viewport while stream growth retains the chosen turn', async () => {
  await page.viewport(1600, 1000)
  const fixture = await open()
  const rail = page.getByRole('navigation', { name: 'Conversation turns' })
  await expect.element(rail).toBeVisible()
  const scroller = document.querySelector<HTMLElement>('.conversation-message-scroll')!
  const nav = rail.element().getBoundingClientRect()
  expect(nav.left - scroller.getBoundingClientRect().left).toBe(12)
  await page.getByRole('button', { name: 'Jump to turn 2', exact: true }).hover()
  await expect.poll(() => document.querySelector('[role="tooltip"]')?.textContent).toContain('Question 2: inspect the built-in tools')
  await page.getByRole('button', { name: 'Jump to turn 1', exact: true }).click()
  await expect.poll(() => scroller.scrollTop).toBeLessThanOrEqual(1)
  await expect.element(page.getByRole('button', { name: 'Jump to turn 1', exact: true })).toHaveAttribute('aria-current', 'true')
  const before = scroller.scrollTop
  fixture.sendServer({
    type: 'entry',
    sessionId: 's-1',
    entry: { sessionId: 's-1', seq: 29, kind: 'run_start', payloadVersion: 1, payload: { trigger: 'submit' }, runId: 'detail-5', createdAt: 29000 },
  })
  expect(scroller.scrollTop).toBe(before)
  await page.getByRole('button', { name: 'Return to bottom', exact: true }).click()
  await expect.poll(() => scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop).toBeLessThanOrEqual(1)
})

it.each(['light', 'dark'] as const)('actual App: %s turn previews render Markdown for the prompt and reply on hover and keyboard focus', async (theme) => {
  await page.viewport(1600, 1000)
  const prompt = '## **Question** with `code` and [guide](https://example.com/guide)'
  const reply = '### Answer\n\nA **formatted** reply with *emphasis* and `inline`.\n\n- First item\n- Second item\n\n```ts\nconst value = 1\n```'
  const entries: SessionEntryRecord[] = ['markdown-1', 'markdown-2'].flatMap((runId, index) =>
    [
      { kind: 'run_start', payload: { trigger: 'submit' } },
      { kind: 'message', payload: { role: 'user', content: prompt, timestamp: 0 } },
      { kind: 'message', payload: { role: 'assistant', content: [{ type: 'text', text: reply }], stopReason: 'stop', timestamp: 0 } },
      { kind: 'run_end', payload: { status: 'completed' } },
    ].map((entry, offset) => ({ ...entry, sessionId: 's-1', seq: index * 4 + offset + 1, runId, payloadVersion: 1, createdAt: index * 4 + offset })),
  )
  await open(theme, 2, entries)
  const turn = page.getByRole('button', { name: 'Jump to turn 1', exact: true })
  await turn.hover()
  const preview = page.getByRole('tooltip')
  await expect.element(preview).toBeVisible()
  const rendered = preview.element()
  expect(rendered.querySelector('.conversation-turn-prompt h2 [data-streamdown="strong"]')?.textContent).toBe('Question')
  expect(rendered.querySelector('.conversation-turn-prompt code')?.textContent).toBe('code')
  expect(rendered.querySelector('.conversation-turn-prompt [data-streamdown="link"]')?.textContent).toBe('guide')
  expect(rendered.querySelector('.conversation-turn-response h3')?.textContent).toBe('Answer')
  expect(rendered.querySelector('.conversation-turn-response [data-streamdown="strong"]')?.textContent).toBe('formatted')
  expect(rendered.querySelector('.conversation-turn-response em')?.textContent).toBe('emphasis')
  expect(rendered.querySelector('.conversation-turn-response li')?.textContent).toBe('First item')
  expect(rendered.textContent).not.toContain('##')
  expect(rendered.textContent).not.toContain('**')
  expect(rendered.querySelector('[data-streamdown="code-block"] button')).toBeNull()
  expect(rendered.getBoundingClientRect().height).toBeLessThanOrEqual(100)
  await page.getByRole('textbox', { name: 'Give Coko a task' }).hover()
  await expect.element(preview).not.toBeInTheDocument()
  turn.element().focus()
  await expect.element(preview).toBeVisible()
  expect(preview.element().querySelector('.conversation-turn-response [data-streamdown="strong"]')?.textContent).toBe('formatted')
  await userEvent.keyboard('{Tab}{Tab}')
  await expect.element(page.getByRole('textbox', { name: 'Give Coko a task' })).toHaveFocus()
})

it('actual App: default content width opens wide without dragging or a saved preference', async () => {
  localStorage.removeItem('coko.conversation.contentWidth')
  await page.viewport(1600, 1000)
  await open()
  const column = document.querySelector<HTMLElement>('[data-slot="conversation-messages"]')!
  await expect.poll(() => column.getBoundingClientRect().width).toBe(1144)
  expect(document.querySelector('[data-slot="composer"]')!.getBoundingClientRect().width).toBe(1176)
})

it('actual App: shared width can widen, persist and reset without overflowing the narrow view', async () => {
  await page.viewport(1600, 1000)
  const fixture = await open()
  const column = document.querySelector<HTMLElement>('[data-slot="conversation-messages"]')!
  const composer = document.querySelector<HTMLElement>('[data-slot="composer"]')!
  const before = column.getBoundingClientRect().width
  const handle = document.querySelector<HTMLElement>('[data-slot="conversation-width-handle"][data-side="right"]')!
  handle.focus()
  await userEvent.keyboard('{ArrowLeft}')
  await expect.poll(() => column.getBoundingClientRect().width).toBeCloseTo(before - 32, 0)
  await userEvent.keyboard('{ArrowRight}')
  await expect.poll(() => column.getBoundingClientRect().width).toBeCloseTo(before, 0)
  expect(composer.getBoundingClientRect().width - column.getBoundingClientRect().width).toBeCloseTo(32, 0)
  await userEvent.keyboard('{ArrowLeft}')
  expect(localStorage.getItem('coko.conversation.contentWidth')).not.toBeNull()
  fixture.chat.getState().startDraft()
  fixture.chat.getState().openSession('s-1')
  await expect.poll(() => document.querySelector('[data-slot="conversation-messages"]')!.getBoundingClientRect().width).toBeCloseTo(before - 32, 0)
  await page.viewport(390, 800)
  await expect.poll(() => getComputedStyle(document.querySelector('.conversation-turn-navigator')!).display).toBe('none')
  await expect.poll(() => document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
  await page.viewport(1600, 1000)
  const reset = page.getByRole('separator', { name: 'Conversation content width', exact: true }).last()
  await expect.element(reset).toBeVisible()
  reset.element().focus()
  await userEvent.keyboard('{Home}')
  expect(localStorage.getItem('coko.conversation.contentWidth')).toBeNull()
  await expect.poll(() => document.querySelector('[data-slot="conversation-messages"]')!.getBoundingClientRect().width).toBeCloseTo(before, 0)
})

it('actual App: a long turn rail scrolls and virtualizes marks, retaining keyboard access to the active turn', async () => {
  await page.viewport(1600, 1000)
  await open('light', 90)
  await page.getByRole('textbox', { name: 'Give Coko a task' }).hover()
  const rail = document.querySelector<HTMLElement>('.conversation-turn-scroller')!
  await expect.poll(() => rail.scrollTop).toBeGreaterThan(0)
  expect(rail.clientHeight).toBeLessThanOrEqual(420)
  expect(rail.scrollHeight).toBeGreaterThan(rail.clientHeight)
  expect(rail.querySelectorAll('button').length).toBeLessThan(60)
  await expect.element(page.getByRole('button', { name: 'Jump to turn 90', exact: true })).toBeVisible()
  rail.scrollTop = 0
  await expect.element(page.getByRole('button', { name: 'Jump to turn 1', exact: true })).toBeVisible()
})
