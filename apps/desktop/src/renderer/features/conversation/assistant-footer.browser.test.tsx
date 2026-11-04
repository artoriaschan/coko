import '../../styles.css'
import type { SessionEntryRecord } from '@coko/protocol'
import { afterEach, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'

afterEach(async () => {
  vi.restoreAllMocks()
  window.getSelection()?.removeAllRanges()
  await page.viewport(1280, 800)
})
const record = (seq: number, kind: string, payload: unknown, runId = 'r1', createdAt = 1_700_000_000_000 + seq): SessionEntryRecord => ({
  sessionId: 's-1',
  seq,
  kind,
  payload,
  runId,
  createdAt,
  payloadVersion: 1,
})
const answer = (seq: number, texts: string[], runId = 'r1') =>
  record(
    seq,
    'message',
    {
      role: 'assistant',
      content: texts.map((text) => ({ type: 'text', text })),
      timestamp: 1,
      stopReason: 'stop',
    },
    runId,
  )
const metered = (seq: number, runId = 'r1') =>
  record(
    seq,
    'model_request',
    {
      requestId: `request-${seq}`,
      runId,
      provider: 'configured-provider',
      model: 'model-with-a-long-name',
      purpose: 'turn',
      startedAt: 1,
      durationMs: 10,
      stopReason: 'stop',
      retries: 0,
      usage: { input: 700, cacheRead: 300, cacheWrite: 100, output: 200, total: 1300 },
      usageReport: { complete: true, known: ['input', 'cacheRead', 'cacheWrite', 'output'] },
      reasoning: 50,
      cost: 0.5,
    },
    runId,
  )
async function open(entries: SessionEntryRecord[], theme: 'light' | 'dark' = 'light', locale: 'en' | 'zh' = 'en') {
  const fixture = createFixtureChat({ entries: { 's-1': entries } })
  const appearance = createAppearanceStore({ theme, locale })
  const preferences = createPreferences({ appearance, settings: fixture.settings, onConflict() {}, onFailure() {} })
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

it('actual App waits for Run end, attaches one footer to the final reply and copies its complete raw Markdown', async () => {
  const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
  const fixture = await open([
    record(1, 'run_start', { trigger: 'submit' }),
    answer(2, ['Stage answer']),
    answer(3, ['**Final**', 'Second _block_.']),
    metered(4),
  ])
  expect(document.querySelector('[data-slot="assistant-footer"]')).toBeNull()
  expect(document.querySelector('[data-slot="assistant-message-actions"]')).toBeNull()
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: record(5, 'run_end', { status: 'completed' }, 'r1', Date.parse('2026-11-03T15:08:45Z')) })
  await expect.poll(() => document.querySelectorAll('[data-slot="assistant-footer"]').length).toBe(1)
  const finalMessage = page.getByRole('article', { name: 'Coko', exact: true }).last()
  await expect.element(finalMessage.getByText('Second block.', { exact: true })).toBeVisible()
  const footer = document.querySelector('[data-slot="assistant-footer"]')!
  expect(footer.closest('article')).toBe(finalMessage.element())
  expect(document.querySelector('[data-slot="run-usage"]')).toBeNull()
  expect(footer.querySelector('time')?.getAttribute('datetime')).toBe('2026-11-03T15:08:45.000Z')
  expect(footer.textContent).not.toMatch(/\$|Cost|Unpriced/)
  await userEvent.click(page.getByRole('button', { name: 'Copy message', exact: true }))
  expect(clipboard).toHaveBeenCalledWith('**Final**\n\nSecond _block_.')
  await expect.element(page.getByRole('button', { name: 'Copied message', exact: true })).toBeVisible()
})

it('usage popover shows exact exclusive buckets, provenance and reported reasoning without fees, and restores focus', async () => {
  await open([record(1, 'run_start', { trigger: 'submit' }), answer(2, ['Done']), metered(3), record(4, 'run_end', { status: 'completed' })])
  const trigger = document.querySelector<HTMLButtonElement>('[data-action="run-usage"]')!
  await userEvent.click(trigger)
  const card = page.getByRole('dialog', { name: 'Turn usage', exact: true })
  await expect.element(card).toBeVisible()
  const detail = card.element()
  expect(detail.querySelector('[data-usage-part="total"]')?.textContent).toContain('1,300')
  for (const [part, value] of [
    ['input', '700'],
    ['cacheRead', '300'],
    ['cacheWrite', '100'],
    ['output', '200'],
    ['reasoning', '50'],
  ] as const)
    expect(detail.querySelector(`[data-usage-part="${part}"]`)?.textContent).toContain(value)
  expect(detail.textContent).toContain('configured-provider')
  expect(detail.textContent).toContain('model-with-a-long-name')
  expect(detail.textContent).toContain('27.3%')
  expect([...detail.querySelectorAll('[data-turn-usage-details] dt')].map((node) => node.textContent)).toEqual([
    'Provider / model',
    'Cache hit',
    'Uncached input',
    'Cached input',
    'Cache write',
    'Output',
  ])
  expect(detail.textContent).not.toMatch(/\$|Cost|Unpriced/)
  await userEvent.keyboard('{Escape}')
  await expect.element(card).not.toBeInTheDocument()
  expect(document.activeElement).toBe(trigger)
  await userEvent.click(trigger)
  await expect.element(card).toBeVisible()
  await userEvent.click(trigger)
  await expect.element(card).not.toBeInTheDocument()
  await userEvent.click(trigger)
  await page.getByRole('heading', { level: 1 }).click()
  await expect.element(card).not.toBeInTheDocument()
  expect(document.activeElement).toBe(trigger)
})

it('historical footers reveal as a whole for hover or focus, stay visible while the portaled card is open, and include the time', async () => {
  await open([
    record(1, 'run_start', { trigger: 'submit' }),
    answer(2, ['Earlier answer']),
    metered(3),
    record(4, 'run_end', { status: 'completed' }),
    record(5, 'run_start', { trigger: 'submit' }, 'r2'),
    answer(6, ['Latest answer'], 'r2'),
    metered(7, 'r2'),
    record(8, 'run_end', { status: 'completed' }, 'r2'),
  ])
  const prior = document.querySelector<HTMLElement>('[data-slot="assistant-footer"][data-run-id="r1"]')!
  const current = document.querySelector<HTMLElement>('[data-slot="assistant-footer"][data-run-id="r2"]')!
  const controls = prior.querySelector<HTMLElement>('[data-slot="assistant-message-actions"]')!
  await page.getByRole('heading', { level: 1 }).hover()
  await expect.poll(() => getComputedStyle(prior).opacity).toBe('0')
  expect(prior.contains(prior.querySelector('time'))).toBe(true)
  expect(getComputedStyle(current).opacity).toBe('1')
  await page.getByRole('article', { name: 'Coko', exact: true }).first().hover()
  await expect.poll(() => getComputedStyle(prior).opacity).toBe('1')
  const trigger = document.querySelectorAll<HTMLButtonElement>('[data-action="run-usage"]')[0]!
  await userEvent.click(trigger)
  const card = page.getByRole('dialog', { name: 'Turn usage', exact: true })
  await card.hover()
  expect(getComputedStyle(controls).opacity).toBe('1')
  await userEvent.keyboard('{Escape}')
  await expect.element(card).not.toBeInTheDocument()
  expect(document.activeElement).toBe(trigger)
  expect(getComputedStyle(controls).opacity).toBe('1')
})

it('partial multi-model usage names its reported subtotal and omits unsupported reasoning and cache ratios', async () => {
  const first = metered(3)
  const firstPayload = first.payload as Record<string, unknown>
  const second = metered(4)
  await open([
    record(1, 'run_start', { trigger: 'submit' }),
    answer(2, ['Done']),
    { ...first, payload: { ...firstPayload, reasoning: undefined } },
    {
      ...second,
      payload: {
        ...(second.payload as Record<string, unknown>),
        provider: 'other-provider',
        model: 'other-model',
        reasoning: undefined,
        usage: { input: 0, cacheRead: 0, cacheWrite: 0, output: 9, total: 9 },
        usageReport: { complete: false, known: ['output'] },
      },
    },
    record(5, 'run_end', { status: 'completed' }),
  ])
  await userEvent.click(document.querySelector<HTMLButtonElement>('[data-action="run-usage"]')!)
  const card = page.getByRole('dialog', { name: 'Turn usage', exact: true })
  await expect.element(card).toBeVisible()
  const detail = card.element()
  expect(detail.querySelector('[data-usage-part="total"]')?.textContent).toBe('1,309')
  expect(detail.textContent).toContain('Some requests did not report complete usage')
  expect(detail.textContent).toContain('Provider / model')
  expect(detail.textContent).toContain('other-provider/other-model')
  expect(detail.querySelector('[data-usage-part="input"]')?.textContent).toContain('≥ 700')
  expect(detail.querySelector('[data-usage-part="reasoning"]')).toBeNull()
  expect(detail.querySelector('[data-usage-part="cacheHit"]')).toBeNull()
  await userEvent.keyboard('{Escape}')
  await expect.element(card).not.toBeInTheDocument()
})

it('omits cache rows the provider did not report, even when the usage object carries values', async () => {
  const request = metered(3)
  await open([
    record(1, 'run_start', { trigger: 'submit' }),
    answer(2, ['Done']),
    { ...request, payload: { ...(request.payload as Record<string, unknown>), usageReport: { complete: true, known: ['input', 'output'] } } },
    record(4, 'run_end', { status: 'completed' }),
  ])
  const footer = document.querySelector('[data-slot="assistant-footer"]')!
  expect(footer.getAttribute('data-complete')).toBe('true')
  await userEvent.click(document.querySelector<HTMLButtonElement>('[data-action="run-usage"]')!)
  const card = page.getByRole('dialog', { name: 'Turn usage', exact: true })
  await expect.element(card).toBeVisible()
  expect(card.element().querySelector('[data-usage-part="cacheRead"]')).toBeNull()
  expect(card.element().querySelector('[data-usage-part="cacheWrite"]')).toBeNull()
  expect(card.element().querySelector('[data-usage-part="cacheHit"]')).toBeNull()
})

it('hides cache rows whose reported counts are zero', async () => {
  const request = metered(3)
  const payload = request.payload as Record<string, unknown>
  const usage = payload.usage as Record<string, number>
  await open([
    record(1, 'run_start', { trigger: 'submit' }),
    answer(2, ['Done']),
    {
      ...request,
      payload: {
        ...payload,
        usage: { ...usage, cacheRead: 0, cacheWrite: 0, total: 900 },
        usageReport: { complete: true, known: ['input', 'output', 'cacheRead', 'cacheWrite'] },
      },
    },
    record(4, 'run_end', { status: 'completed' }),
  ])
  await userEvent.click(document.querySelector<HTMLButtonElement>('[data-action="run-usage"]')!)
  const card = page.getByRole('dialog', { name: 'Turn usage', exact: true })
  await expect.element(card).toBeVisible()
  expect(card.element().querySelector('[data-usage-part="cacheRead"]')).toBeNull()
  expect(card.element().querySelector('[data-usage-part="cacheWrite"]')).toBeNull()
  expect(card.element().querySelector('[data-usage-part="cacheHit"]')).toBeNull()
})

it.each([
  ['unknown', [], '—'],
  ['partial', ['output'], '200'],
] as const)('%s: unreported normalized fallback values are not presented as known bucket minimums', async (_state, known, expected) => {
  const request = metered(3)
  await open([
    record(1, 'run_start', { trigger: 'submit' }),
    answer(2, ['Done']),
    { ...request, payload: { ...(request.payload as Record<string, unknown>), reasoning: undefined, usageReport: { complete: false, known } } },
    record(4, 'run_end', { status: 'completed' }),
  ])
  const trigger = document.querySelector<HTMLButtonElement>('[data-action="run-usage"]')!
  expect(trigger.textContent).toContain(expected === '—' ? 'Usage unavailable' : '200 tok')
  await userEvent.click(trigger)
  const card = page.getByRole('dialog', { name: 'Turn usage', exact: true })
  await expect.element(card).toBeVisible()
  for (const part of ['cacheRead', 'cacheWrite']) expect(card.element().querySelector(`dd[data-usage-part="${part}"]`)).toBeNull()
  expect(card.element().querySelector('dd[data-usage-part="input"]')?.textContent).toBe('—')
  expect(card.element().querySelector('[data-usage-part="total"]')?.textContent).toBe(expected)
  expect(card.element().querySelector('dd[data-usage-part="output"]')?.textContent).toBe(expected)
  expect(card.element().textContent).toContain('Some requests did not report complete usage')
  await userEvent.keyboard('{Escape}')
  await expect.element(card).not.toBeInTheDocument()
})

it.each([
  ['light', 'en'],
  ['dark', 'en'],
  ['light', 'zh'],
  ['dark', 'zh'],
] as const)('%s/%s: keyboard usage card and long model names fit a 390px content pane', async (theme, locale) => {
  await page.viewport(390, 900)
  const request = metered(3)
  await open(
    [
      record(1, 'run_start', { trigger: 'submit' }),
      answer(2, ['Final answer']),
      { ...request, payload: { ...(request.payload as Record<string, unknown>), model: 'long-model-name-'.repeat(30) } },
      record(4, 'run_end', { status: 'completed' }, 'r1', Date.parse('2026-11-03T15:08:45Z')),
    ],
    theme,
    locale,
  )
  const trigger = document.querySelector<HTMLButtonElement>('[data-action="run-usage"]')!
  expect(trigger.textContent).toContain('1.3K tok')
  trigger.focus()
  await userEvent.keyboard('{Enter}')
  const card = page.getByRole('dialog', { name: locale === 'en' ? 'Turn usage' : '本轮用量', exact: true })
  await expect.element(card).toBeVisible()
  const box = card.element().getBoundingClientRect()
  expect(box.left).toBeGreaterThanOrEqual(0)
  expect(box.right).toBeLessThanOrEqual(window.innerWidth)
  expect(card.element().scrollWidth).toBeLessThanOrEqual(card.element().clientWidth)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)

  await userEvent.keyboard('{Escape}')
  await expect.element(card).not.toBeInTheDocument()
  expect(document.activeElement).toBe(trigger)
  const time = document.querySelector('[data-slot="assistant-footer"] time')!
  expect(time.textContent).toMatch(/\d{2}:\d{2}$/)
  await userEvent.keyboard('{Tab}')
  expect(document.activeElement).toBe(time)
  expect(time.getAttribute('aria-label')).toContain('45')
})
