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

function record(seq: number, payload: unknown, kind = 'message'): SessionEntryRecord {
  return { sessionId: 's-1', seq, kind, payloadVersion: 1, payload, runId: 'message-run', createdAt: seq }
}

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

it('streaming reasoning previews only the latest paragraph with a completed first line and opens compact Markdown manually', async () => {
  const fixture = await open([record(1, { role: 'user', content: 'Check the source', timestamp: 1 })])
  const delta = (text: string) =>
    fixture.sendServer({
      type: 'progress',
      sessionId: 's-1',
      runId: 'message-run',
      event: {
        type: 'assistant_delta',
        kind: 'thinking',
        contentIndex: 0,
        delta: text,
      },
    })
  fixture.sendServer({ type: 'progress', sessionId: 's-1', runId: 'message-run', event: { type: 'run_start' } })
  delta('**First line**')
  const toggle = page.getByRole('button', { name: 'Thinking', exact: true })
  await expect.element(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(document.querySelector('[data-slot="reasoning-summary"]')).toBeNull()
  delta('\ncontinued line\n\n**Latest paragraph**')
  await expect.element(toggle.getByText('First line', { exact: true })).toBeVisible()
  delta('\nnot a summary')
  await expect.element(toggle.getByText('Latest paragraph', { exact: true })).toBeVisible()
  await userEvent.click(toggle)
  await expect.element(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect
    .poll(() => [...document.querySelectorAll('.conversation-reasoning-body [data-streamdown="strong"]')].map((node) => node.textContent))
    .toContain('Latest paragraph')
})

it('committing a streamed reasoning block preserves its open disclosure, body DOM and text selection', async () => {
  const fixture = await open([record(1, { role: 'user', content: 'Check the source', timestamp: 1 })])
  fixture.sendServer({ type: 'progress', sessionId: 's-1', runId: 'message-run', event: { type: 'run_start' } })
  const text = 'Stable reasoning\n\nA detailed explanation.'
  fixture.sendServer({
    type: 'progress',
    sessionId: 's-1',
    runId: 'message-run',
    event: {
      type: 'assistant_delta',
      kind: 'thinking',
      contentIndex: 0,
      delta: text,
    },
  })
  const toggle = page.getByRole('button', { name: 'Thinking', exact: true })
  await userEvent.click(toggle)
  await expect.poll(() => document.querySelector('.conversation-reasoning-body p')?.textContent).toBe('Stable reasoning')
  const row = document.querySelector('[data-slot="reasoning"]')!
  const paragraph = row.querySelector('p')!
  const range = document.createRange()
  range.selectNodeContents(paragraph)
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
  fixture.sendServer({
    type: 'entry',
    sessionId: 's-1',
    entry: record(2, {
      role: 'assistant',
      content: [{ type: 'thinking', thinking: text }],
      stopReason: 'stop',
      timestamp: 2,
    }),
  })
  await expect.poll(() => document.querySelector('[data-slot="reasoning"]')?.hasAttribute('data-streaming')).toBe(false)
  expect(document.querySelector('[data-slot="reasoning"]')).toBe(row)
  await expect.element(toggle).toHaveAttribute('aria-expanded', 'true')
  expect(window.getSelection()!.toString()).toBe('Stable reasoning')
  window.getSelection()!.removeAllRanges()
})

it('message bubbles and actions use the reference geometry and copy original user/assistant content', async () => {
  await page.viewport(1280, 800)
  const fixture = await open([])
  const rect = (selector: string) => {
    const box = document.querySelector(selector)!.getBoundingClientRect()
    return [box.x, box.y, box.width, box.height]
  }
  const header = rect('[data-slot="app-frame-main"] header')
  const composer = rect('[data-slot="composer"]')
  const user = 'Keep **user text** literal'
  const answer = 'An **assistant answer** with `code`.'
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: record(1, { role: 'user', content: user, timestamp: 1 }) })
  fixture.sendServer({
    type: 'entry',
    sessionId: 's-1',
    entry: record(2, { role: 'assistant', content: [{ type: 'text', text: answer }], stopReason: 'stop', timestamp: 2 }),
  })
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: record(3, { status: 'completed' }, 'run_end') })
  await expect.element(page.getByText(user, { exact: true })).toBeVisible()
  const bubble = document.querySelector('[data-slot="user-bubble"]')!
  const style = getComputedStyle(bubble)
  expect([style.fontSize, style.lineHeight, style.padding, style.borderRadius]).toEqual(['14px', '22px', '10px 16px', '20px'])
  expect(rect('[data-slot="app-frame-main"] header')).toEqual(header)
  expect(rect('[data-slot="composer"]')).toEqual(composer)
  const column = document.querySelector('[data-slot="conversation-messages"]')!.getBoundingClientRect()
  expect((column.left + column.right) / 2).toBeCloseTo(composer[0]! + composer[2]! / 2, 2)
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
  await userEvent.click(page.getByRole('article', { name: 'You', exact: true }).getByRole('button', { name: 'Copy message' }))
  expect(write).toHaveBeenLastCalledWith(user)
  await expect.element(page.getByRole('button', { name: 'Copied message', exact: true })).toBeVisible()
  await userEvent.click(page.getByRole('article', { name: 'Coko', exact: true }).getByRole('button', { name: 'Copy message' }))
  expect(write).toHaveBeenLastCalledWith(answer)
  for (const footer of document.querySelectorAll<HTMLElement>('[data-slot="user-message-footer"], [data-slot="assistant-footer"]')) {
    const action = footer.querySelector<HTMLElement>('[data-action="copy-message"]')!
    const box = action.getBoundingClientRect()
    expect([box.width, box.height]).toEqual([22, 22])
    const icon = action.querySelector('svg')!
    expect([getComputedStyle(icon).width, getComputedStyle(icon).height]).toEqual(['14px', '14px'])
    expect(Number.parseFloat(getComputedStyle(icon).strokeWidth)).toBe(1)
    expect(getComputedStyle(footer).margin).toBe('4px')
    expect(getComputedStyle(footer).userSelect).toBe('none')
    expect(getComputedStyle(footer).columnGap).toBe('8px')
    expect(getComputedStyle(footer.querySelector('time')!).fontSize).toBe('12px')
  }
})

it.each([
  ['light', 'en'],
  ['dark', 'en'],
  ['light', 'zh'],
  ['dark', 'zh'],
] as const)('%s/%s: commands, original attachments and compact reasoning remain keyboard accessible in a 390px content pane', async (theme, locale) => {
  await page.viewport(390, 900)
  const path = `src/${'long-directory/'.repeat(8)}source.ts`
  const expanded = `Review **the entire source** and this exact path: ${path}`
  const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/P8AAAAASUVORK5CYII='
  await open(
    [
      record(1, { name: 'review', args: 'src', source: 'project' }, 'command'),
      record(2, {
        role: 'user',
        content: [
          { type: 'text', text: expanded },
          { type: 'text', text: `<file_reference path="${path}">\nexport const original = 1\n</file_reference>` },
          { type: 'image', data: image, mimeType: 'image/png' },
        ],
        timestamp: 2,
      }),
      record(3, {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: ' \n\t' },
          { type: 'thinking', thinking: '**Completed first line**\n\nThe actual reasoning with `code`.' },
          { type: 'text', text: `## Result\n\nAll original content is retained.\n\n\`\`\`ts\nconst path = '${path}'\n\`\`\`` },
        ],
        stopReason: 'stop',
        timestamp: 3,
      }),
    ],
    theme,
    locale,
  )
  await expect.poll(() => document.querySelector('[data-slot="app-frame-main"]')!.getBoundingClientRect().width).toBe(390)
  const footer = document.querySelector<HTMLElement>('[data-slot="user-message-footer"]')!
  expect(footer.querySelector('[data-action="fork"]')).toBeNull()
  const sentTime = footer.querySelector('time')!
  expect(sentTime.dateTime).toBe(new Date(2).toISOString())
  sentTime.focus()
  await userEvent.keyboard('{Tab}')
  expect(document.activeElement?.getAttribute('data-action')).toBe('copy-message')
  expect(document.activeElement?.getAttribute('aria-label')).toBe(locale === 'zh' ? '复制消息' : 'Copy message')
  const command = document.querySelector<HTMLElement>('[data-slot="command-message"] summary')!
  command.focus()
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => document.querySelector('[data-slot="command-message"]')?.hasAttribute('open')).toBe(true)
  expect(document.querySelector('[data-slot="command-expanded"]')?.textContent).toBe(expanded)
  const ref = document.querySelector<HTMLElement>('[data-slot="file-reference-chip"]')!
  expect(ref.textContent).toBe(path)
  expect(ref.scrollWidth).toBeLessThanOrEqual(ref.clientWidth)
  await expect.poll(() => document.querySelector<HTMLImageElement>('[data-slot="user-message"] img')?.naturalWidth).toBe(1)
  expect(document.querySelectorAll('[data-slot="reasoning"]')).toHaveLength(1)
  const toggle = document.querySelector<HTMLButtonElement>('.conversation-reasoning-toggle')!
  toggle.focus()
  await userEvent.keyboard('{Enter}')
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  expect(document.activeElement).toBe(toggle)
  await expect.poll(() => document.querySelector('.conversation-reasoning-body .coko-markdown') !== null).toBe(true)
  const body = getComputedStyle(document.querySelector('.conversation-reasoning-body .coko-markdown')!)
  expect([body.fontSize, body.lineHeight]).toEqual(['13px', '20px'])
  await userEvent.keyboard('{Enter}')
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(document.activeElement).toBe(toggle)
  const main = document.querySelector<HTMLElement>('[data-slot="app-frame-main"]')!
  expect(main.getBoundingClientRect().width).toBe(390)
  const composer = document.querySelector('[data-slot="composer"]')!.getBoundingClientRect()
  const messages = document.querySelector('[data-slot="conversation-messages"]')!.getBoundingClientRect()
  expect(messages.width).toBe(composer.width - 32)
  expect((messages.left + messages.right) / 2).toBe((composer.left + composer.right) / 2)
  expect(main.scrollWidth).toBeLessThanOrEqual(main.clientWidth)
  expect(getComputedStyle(document.querySelector('[data-slot="user-bubble"]')!).backgroundColor).toBe(
    theme === 'light' ? 'rgb(237, 243, 254)' : 'rgb(44, 44, 46)',
  )
})

it('assistant Markdown follows the reference paragraph/list rhythm and compact code banner without overflowing the message column', async () => {
  await open([
    record(1, {
      role: 'assistant',
      content: [{ type: 'text', text: 'First paragraph.\n\n## Heading\n\nSecond paragraph.\n\n- First item\n- Second item\n\n```ts\nconst result = 42\n```' }],
      stopReason: 'stop',
      timestamp: 1,
    }),
  ])
  await expect.poll(() => document.querySelector('[data-streamdown="code-block-body"] pre') !== null).toBe(true)
  const code = getComputedStyle(document.querySelector('[data-streamdown="code-block-body"] pre')!)
  expect([code.fontSize, code.lineHeight]).toEqual(['11px', '19px'])
  const heading = getComputedStyle(document.querySelector('.conversation-assistant-message h2')!)
  expect([heading.marginTop, heading.marginBottom]).toEqual(['32px', '16px'])
  const items = document.querySelectorAll('.conversation-assistant-message li')
  expect([getComputedStyle(items[1]!).marginTop, getComputedStyle(items[1]!).padding]).toEqual(['6px', '0px'])
})

it('phase replies stay visible while the assistant action footer belongs to the final response', async () => {
  await open([
    record(1, {
      role: 'assistant',
      content: [
        { type: 'text', text: 'A phase reply' },
        { type: 'toolCall', id: 'read-source', name: 'read', arguments: { path: 'source.ts' } },
      ],
      stopReason: 'toolUse',
      timestamp: 1,
    }),
    record(2, {
      role: 'toolResult',
      toolCallId: 'read-source',
      toolName: 'read',
      content: [{ type: 'text', text: 'source content' }],
      isError: false,
      timestamp: 2,
    }),
    record(3, { role: 'assistant', content: [{ type: 'text', text: 'The final response' }], stopReason: 'stop', timestamp: 3 }),
    record(4, { status: 'completed' }, 'run_end'),
  ])
  await expect.element(page.getByText('A phase reply', { exact: true })).toBeVisible()
  await expect.element(page.getByText('The final response', { exact: true })).toBeVisible()
  expect(document.querySelectorAll('[data-slot="assistant-message-actions"]')).toHaveLength(1)
})

it('user footer reveals copy and rewind on hover or keyboard focus while the latest user message keeps them visible', async () => {
  const today = new Date()
  const submitted = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 7, 41).getTime()
  const earlierSent = submitted - 60_000
  const fixture = await open([
    { ...record(1, { role: 'user', content: 'Earlier **input**', timestamp: earlierSent }), createdAt: earlierSent },
    { ...record(2, { role: 'user', content: 'Original **input**', timestamp: submitted }), createdAt: submitted },
  ])
  await expect.poll(() => document.querySelectorAll('[data-slot="user-message"]').length).toBe(2)
  const articles = [...document.querySelectorAll<HTMLElement>('[data-slot="user-message"]')]
  const earlier = articles[0]!
  const latest = articles[1]!
  const footer = (article: HTMLElement) => article.querySelector<HTMLElement>('[data-slot="user-message-footer"]')!
  const time = latest.querySelector('time')!
  await expect.element(page.getByText('23:07', { exact: true })).toBeVisible()
  expect(time.dateTime).toBe(new Date(submitted).toISOString())
  expect(time.getAttribute('aria-label')).toContain('41')
  expect(latest.querySelector('[data-action="fork"]')).toBeNull()
  await userEvent.hover(page.getByRole('heading', { level: 1 }))
  await expect.poll(() => getComputedStyle(footer(earlier)).opacity).toBe('0')
  expect(footer(latest).getAttribute('data-latest')).toBe('true')
  expect(getComputedStyle(footer(latest)).opacity).toBe('1')
  expect(footer(latest).contains(time)).toBe(true)
  await userEvent.hover(earlier)
  await expect.poll(() => getComputedStyle(footer(earlier)).opacity).toBe('1')
  time.focus()
  await userEvent.keyboard('{Tab}')
  expect(document.activeElement?.getAttribute('data-action')).toBe('copy-message')
  await userEvent.keyboard('{Tab}')
  expect(document.activeElement?.getAttribute('data-action')).toBe('rewind')
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('dialog')).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  expect(fixture.chat.getState().conversations['s-1']?.entries).toHaveLength(2)
  expect(time.dateTime).toBe(new Date(submitted).toISOString())
})

it('copying a command uses its invocation, and a clipboard failure cannot claim success', async () => {
  await open([
    record(1, { name: 'review', args: 'src', source: 'project' }, 'command'),
    record(2, { role: 'user', content: 'Expanded model-only instruction', timestamp: 2 }),
  ])
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
  const article = page.getByRole('article', { name: 'You', exact: true })
  await article.getByRole('button', { name: 'Copy message' }).click()
  expect(write).toHaveBeenLastCalledWith('/review src')
  await expect.element(article.getByRole('button', { name: 'Copied message' })).toBeVisible()
  write.mockRejectedValue(new Error('Clipboard denied'))
  await article.getByRole('button', { name: 'Copied message' }).click()
  await expect.element(page.getByText('Could not copy the message', { exact: true })).toBeVisible()
  await expect.element(article.getByRole('button', { name: 'Copy message' })).toBeVisible()
})

it('history shows copied attachments by name and opens the retained copy', async () => {
  const copied = '/data/attachments/s-1/123-notes.txt'
  const openFile = vi.fn<(path: string) => Promise<boolean>>(async () => true)
  vi.stubGlobal('coko', { onMenuClose: () => () => {}, openFile })
  try {
    await open([
      record(1, {
        role: 'user',
        content: [
          { type: 'text', text: 'Read the file' },
          { type: 'text', text: '<coko_attachment>{"name":"notes.txt","path":"' + copied + '"}</coko_attachment>' },
        ],
        timestamp: 1,
      }),
    ])
    await userEvent.click(page.getByRole('button', { name: 'notes.txt', exact: true }))
    expect(openFile).toHaveBeenCalledWith(copied)
    openFile.mockResolvedValueOnce(false)
    await userEvent.click(page.getByRole('button', { name: 'notes.txt', exact: true }))
    await expect.element(page.getByRole('alert')).toHaveTextContent('Could not open the attachment. Check that the copied file still exists.')
    expect(document.querySelector('[data-slot="user-bubble"]')?.textContent).toBe('Read the file')
  } finally {
    vi.unstubAllGlobals()
  }
})
