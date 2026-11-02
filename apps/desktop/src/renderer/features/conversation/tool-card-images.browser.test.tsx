// 工具结果中的图片（例如浏览器 MCP 的截图）：通用工具卡在结果下显示缩略图（img 实际解码，naturalWidth > 0），
// "查看大图"按钮（键盘可达）打开对话框显示原图，Escape 关闭后焦点回到按钮；只显示 PNG / JPEG / GIF / WebP（SVG 等不显示）。
import '../../styles.css'
import type { SessionEntryRecord } from '@coko/protocol'
import { TooltipProvider } from '@coko/ui'
import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { ChatStoreProvider, useChat } from '../../app/chat.tsx'
import { I18nProvider } from '../../app/i18n.tsx'
import { createFixtureChat } from '../../testing/fixture-chat.ts'
import { buildTimeline } from './timeline.ts'
import { TimelineView } from './timeline-view.tsx'

/** 2 × 2 PNG。 */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg=='
const SVG = btoa('<svg xmlns="http://www.w3.org/2000/svg"/>')

let seq = 100
const rec = (kind: string, payload: unknown): SessionEntryRecord => ({
  sessionId: 'p1',
  seq: ++seq,
  kind,
  payloadVersion: 1,
  payload,
  runId: 'run-1',
  createdAt: seq,
})
const call = (id: string, name: string) =>
  rec('message', {
    role: 'assistant',
    content: [{ type: 'toolCall', id, name, arguments: { url: 'https://example.test' } }],
    stopReason: 'toolUse',
    timestamp: 0,
  })
const result = (id: string, name: string, content: unknown[]) =>
  rec('message', { role: 'toolResult', toolCallId: id, toolName: name, content, isError: false, timestamp: 0 })

async function mount(entries: SessionEntryRecord[]) {
  const fixture = createFixtureChat({ entries: { p1: entries } })
  await expect.poll(() => fixture.chat.lists.getState().listStatus).toBe('ready')
  fixture.chat.getState().openSession('p1')
  await expect.poll(() => fixture.chat.getState().conversations.p1?.status).toBe('ready')
  const Timeline = () => {
    const conversation = useChat((s) => s.conversations.p1)
    return conversation ? <TimelineView items={buildTimeline(conversation)} theme="light" onRetry={() => {}} /> : null
  }
  return render(
    <I18nProvider locale="en">
      <ChatStoreProvider store={fixture.chat}>
        <TooltipProvider>
          <div style={{ width: 640 }} className="flex flex-col gap-2">
            <Timeline />
          </div>
        </TooltipProvider>
      </ChatStoreProvider>
    </I18nProvider>,
  )
}

describe('工具结果中的图片', () => {
  it('通用工具卡显示缩略图并可打开原图（键盘）；非位图类型不显示', async () => {
    await mount([
      call('s1', 'mcp__playwright__screenshot'),
      result('s1', 'mcp__playwright__screenshot', [
        { type: 'text', text: 'Screenshot of https://example.test' },
        { type: 'image', data: PNG, mimeType: 'image/png' },
        { type: 'image', data: SVG, mimeType: 'image/svg+xml' },
      ]),
    ])
    const card = document.querySelector<HTMLElement>('[data-slot="tool-card"][data-tool="mcp__playwright__screenshot"]')!
    await page
      .elementLocator(card)
      .getByRole('button', { name: /Tool call/ })
      .click()
    const thumb = page.elementLocator(card).getByRole('img', { name: 'Image 1 returned by the tool' })
    await expect.element(thumb).toBeVisible()
    await expect.poll(() => (thumb.element() as HTMLImageElement).naturalWidth).toBeGreaterThan(0)
    expect(card.querySelectorAll('[data-tool-image]')).toHaveLength(1)
    expect(card.textContent).toContain('Screenshot of https://example.test')

    const open = page.elementLocator(card).getByRole('button', { name: 'View full size' })
    open.element().focus()
    await userEvent.keyboard('{Enter}')
    const dialog = page.getByRole('dialog')
    await expect.element(dialog).toBeVisible()
    const full = dialog.element().querySelector<HTMLImageElement>('img')!
    await expect.poll(() => full.naturalWidth).toBe(2)
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => document.querySelector('[role=dialog]')).toBeNull()
    await expect.poll(() => document.activeElement).toBe(open.element())
  })
})
