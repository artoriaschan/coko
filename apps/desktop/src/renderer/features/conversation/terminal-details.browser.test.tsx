import '../../styles.css'
import type { SessionEntryRecord } from '@coko/protocol'
import { afterEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
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
  runId: 'run-1',
  createdAt: seq,
})
const call = (seq: number, id: string, command: string) =>
  entry(seq, 'message', { role: 'assistant', content: [{ type: 'toolCall', id, name: 'bash', arguments: { command } }], stopReason: 'toolUse', timestamp: 0 })
const result = (seq: number, id: string, text: string, structuredContent?: unknown, isError = false) =>
  entry(seq, 'message', { role: 'toolResult', toolCallId: id, toolName: 'bash', content: [{ type: 'text', text }], structuredContent, isError, timestamp: 0 })

const initialViewport = { width: window.innerWidth, height: window.innerHeight }
afterEach(async () => {
  vi.restoreAllMocks()
  await page.viewport(initialViewport.width, initialViewport.height)
})

async function open(entries: SessionEntryRecord[], theme: 'light' | 'dark' = 'light', locale: 'zh' | 'en' = 'en') {
  const fixture = createFixtureChat({ entries: { 's-1': entries } })
  const appearance = createAppearanceStore({ theme, locale })
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

it('actual App: terminal preserves the real command, ANSI output and recorded exit; copy uses raw output and long output scrolls inside the terminal', async () => {
  const command = 'printf "sample\\n"\nexit 7'
  const raw = '\u001b[31mfailure\u001b[0m\n' + 'a very long original line '.repeat(30) + '\n' + Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n')
  const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
  await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    call(2, 'b', command),
    result(3, 'b', raw, { output: raw, exit_code: 7, wall_time_seconds: 0.4, truncated: false }, true),
    entry(4, 'run_end', { status: 'error' }),
  ])
  await page.getByRole('button', { name: /Bash/ }).click()
  const terminal = document.querySelector<HTMLElement>('[data-terminal]')!
  expect(terminal).not.toBeNull()
  expect([...terminal.querySelectorAll('[data-command-text]')].map((el) => el.textContent).join('')).toBe(command)
  expect(terminal.textContent).toContain('Exit 7')
  const output = terminal.querySelector<HTMLElement>('[data-terminal-output]')!
  expect(output.textContent).toContain('line 40')
  expect(output.textContent).not.toContain('\u001b')
  expect(output.querySelector('.text-terminal-red')?.textContent).toBe('failure')
  expect(output.scrollHeight).toBeGreaterThan(output.clientHeight)
  expect(output.clientHeight).toBe(224)
  expect(output.scrollWidth).toBeGreaterThan(output.clientWidth)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  await page.getByRole('button', { name: 'Copy', exact: true }).click()
  await expect.element(page.getByRole('button', { name: 'Copied', exact: true })).toBeVisible()
  expect(clipboard).toHaveBeenLastCalledWith(raw)
})

it('actual App: command is copyable before output; streaming and committed results retain expansion, selection and the output reading position', async () => {
  const fixture = await open([entry(1, 'run_start', { trigger: 'submit' })])
  const command = 'printf "original command"'
  const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
  fixture.sendServer({
    type: 'progress',
    sessionId: 's-1',
    runId: 'run-1',
    event: { type: 'tool_start', toolCallId: 'b', toolName: 'bash', args: { command } },
  })
  await page.getByRole('button', { name: /Bash/ }).click()
  const terminal = document.querySelector('[data-terminal]')!
  await page.getByRole('button', { name: 'Copy command', exact: true }).click()
  expect(clipboard).toHaveBeenLastCalledWith(command)
  const raw = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\n')
  const update = (text: string) =>
    fixture.sendServer({
      type: 'progress',
      sessionId: 's-1',
      runId: 'run-1',
      event: { type: 'tool_update', toolCallId: 'b', toolName: 'bash', partialResult: { content: [{ type: 'text', text }] } },
    })
  update(raw)
  await expect.poll(() => terminal.querySelector('[data-terminal-output]')?.textContent).toContain('line 60')
  const output = terminal.querySelector<HTMLElement>('[data-terminal-output]')!
  output.scrollTop = 90
  const commandText = terminal.querySelector('[data-command-text]')!
  const range = document.createRange()
  range.selectNodeContents(commandText)
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
  update(raw + '\nlast progress')
  await expect.poll(() => output.textContent).toContain('last progress')
  expect(output.scrollTop).toBe(90)
  fixture.sendServer({
    type: 'progress',
    sessionId: 's-1',
    runId: 'run-1',
    event: {
      type: 'tool_end',
      toolCallId: 'b',
      toolName: 'bash',
      result: { content: [{ type: 'text', text: raw + '\nsettled' }], structuredContent: { output: raw + '\nsettled', exit_code: 7, truncated: false } },
      isError: true,
    },
  })
  await expect.poll(() => terminal.textContent).toContain('Exit 7')
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: call(2, 'b', command) })
  fixture.sendServer({
    type: 'entry',
    sessionId: 's-1',
    entry: result(3, 'b', raw + '\ncommitted', undefined, true),
  })
  await expect.poll(() => terminal.textContent).toContain('Exit 7')
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: entry(4, 'run_end', { status: 'error' }) })
  await expect.poll(() => output.textContent).toContain('committed')
  expect(terminal.querySelector('.conversation-terminal-exit')).toBeNull()
  expect(document.querySelector('[data-terminal]')).toBe(terminal)
  expect(terminal.querySelector('[data-terminal-output]')).toBe(output)
  expect(output.scrollTop).toBe(90)
  expect(window.getSelection()!.toString()).toBe(command)
  expect(document.querySelectorAll('[data-slot="tool-card"]')).toHaveLength(1)
  expect(document.querySelector('[data-slot="tool-card"] button')!.getAttribute('aria-expanded')).toBe('true')
})

it.each([
  ['light', 'en'],
  ['light', 'zh'],
  ['dark', 'en'],
  ['dark', 'zh'],
] as const)('actual App: %s/%s terminal stays readable at 390px, retains plain results and never invents an exit or duration', async (theme, locale) => {
  await page.viewport(390, 800)
  const raw = 'unchanged 原文 ' + 'long-output-'.repeat(100)
  await open(
    [
      entry(1, 'run_start', { trigger: 'submit' }),
      call(2, 'plain', 'echo ' + 'long-command-'.repeat(40)),
      result(3, 'plain', raw),
      call(4, 'stopped', 'make'),
      result(5, 'stopped', 'Command aborted', undefined, true),
      call(6, 'empty', 'waiting'),
      entry(7, 'run_end', { status: 'interrupted' }),
    ],
    theme,
    locale,
  )
  const rows = [...document.querySelectorAll<HTMLElement>('[data-slot="tool-card"]')]
  for (const row of rows) await page.elementLocator(row).getByRole('button').click()
  const plain = rows[0]!.querySelector<HTMLElement>('[data-terminal]')!
  expect(plain.textContent).toContain(raw)
  expect(plain.querySelector('.conversation-terminal-exit')).toBeNull()
  expect(plain.textContent).not.toMatch(/0s|0秒|Exit 0|退出码 0/)
  expect(plain.getBoundingClientRect().right).toBeLessThanOrEqual(390)
  expect(rows[1]!.textContent).toContain('Command aborted')
  expect(rows[1]!.querySelector('.conversation-terminal-exit')).toBeNull()
  expect(rows[2]!.querySelector('[data-terminal-output]')).toBeNull()
  expect(rows[2]!.querySelector('[data-terminal]')!.getAttribute('data-terminal-state')).toBe('pending')
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
  expect(getComputedStyle(plain).fontSize).toBe('11px')
  expect(getComputedStyle(plain).lineHeight).toBe('18px')
})

it('actual App: blocked commands show real arguments and rejection, without a terminal claiming execution', async () => {
  await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    call(2, 'blocked', 'touch protected'),
    {
      ...result(3, 'blocked', 'blocked by policy', undefined, true),
      payload: {
        ...(result(3, 'blocked', 'blocked by policy', undefined, true).payload as object),
        details: { hostBlock: { by: 'hook', command: 'policy-check' } },
      },
    },
    entry(4, 'run_end', { status: 'error' }),
  ])
  await page.getByRole('button', { name: /Bash/ }).click()
  const body = document.querySelector('[data-slot="tool-card-body"]')!
  expect(body.textContent).toContain('touch protected')
  expect(body.textContent).toContain('blocked by policy')
  expect(body.textContent).toContain('policy-check')
  expect(body.querySelector('[data-terminal]')).toBeNull()
})

it('actual App: selecting an earlier output line survives appended output and settlement', async () => {
  const fixture = await open([entry(1, 'run_start', { trigger: 'submit' })])
  const raw = 'first unchanged line\nsecond unchanged line\n'
  fixture.sendServer({
    type: 'progress',
    sessionId: 's-1',
    runId: 'run-1',
    event: { type: 'tool_start', toolCallId: 'selection', toolName: 'bash', args: { command: 'build' } },
  })
  const update = (text: string) =>
    fixture.sendServer({
      type: 'progress',
      sessionId: 's-1',
      runId: 'run-1',
      event: { type: 'tool_update', toolCallId: 'selection', toolName: 'bash', partialResult: { content: [{ type: 'text', text }] } },
    })
  update(raw)
  await page.getByRole('button', { name: /Bash/ }).click()
  const output = document.querySelector('[data-terminal-output]')!
  const firstText = document.createTreeWalker(output, NodeFilter.SHOW_TEXT).nextNode()!
  const range = document.createRange()
  range.setStart(firstText, 0)
  range.setEnd(firstText, 20)
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
  const selected = window.getSelection()!.toString()
  update(raw + 'third appended line\n')
  await expect.poll(() => output.textContent).toContain('third appended line')
  expect(window.getSelection()!.toString()).toBe(selected)
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: call(2, 'selection', 'build') })
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: result(3, 'selection', raw + 'third appended line\n') })
  await expect.poll(() => document.querySelector('[data-slot="tool-card"]')!.getAttribute('data-status')).toBe('done')
  expect(window.getSelection()!.toString()).toBe(selected)
})
