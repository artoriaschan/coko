// 交接的界面（docs/subsystems/handoff.md）：对话框（下一步目标、目标目录、未提交改动提示、错误、进行中与停止、⌘↩ 提交）、时间线的交接行
// （打开目标与跳回源），以及写入目标会话的草稿能被输入区读出（纯文本 EditorState）。
import '../../styles.css'
import type { HandoffTarget, SessionEntryRecord } from '@coko/protocol'
import { ComposerEditor, toast, type ComposerEditorHandle } from '@coko/ui'
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { ChatStoreProvider } from '../../app/chat.tsx'
import { I18nProvider } from '../../app/i18n.tsx'
import { createDraftStore, draftKey, textEditorState, writeSessionDraft } from '../../stores/draft-store.ts'
import { createHandoffStore } from '../../stores/handoff-store.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'
import { HandoffStoresProvider } from './handoff-effects.tsx'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { HandoffRow } from './handoff-row.tsx'

async function mountApp(history: SessionEntryRecord[] = []) {
  const fixture = createFixtureChat(history.length ? { entries: { 's-1': history } } : {})
  const writes: [string, string][] = []
  const starts: { sessionId: string; instructions: string; target: HandoffTarget }[] = []
  const handoff = createHandoffStore({
    backend: {
      start: async (sessionId, input) => {
        starts.push({ sessionId, ...input })
        return { runId: 'retry-run' }
      },
      gitStatus: async () => ({ repo: false, dirtyFiles: 0 }),
      stop: async () => {},
    },
    writeDraft: (id, text) => {
      writes.push([id, text])
    },
  })
  const appearance = createAppearanceStore({ theme: 'light', locale: 'en' })
  const preferences = createPreferences({ appearance, settings: fixture.settings, onConflict: () => {}, onFailure: () => {} })
  const screen = await render(
    <HandoffStoresProvider handoff={handoff}>
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
    </HandoffStoresProvider>,
  )
  await expect.poll(() => fixture.chat.getState().conversations['s-1']?.status).toBe('ready')
  const push = (kind: string, payload: unknown, runId = 'handoff-live') => {
    const seq = fixture.chat.getState().conversations['s-1']!.lastSeq + 1
    fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: { sessionId: 's-1', seq, kind, payload, payloadVersion: 1, runId, createdAt: seq } })
  }
  return { ...fixture, writes, starts, handoff, screen, push }
}

afterEach(async () => {
  toast.dismiss()
  await vi.waitFor(() => {
    if (document.querySelector('[data-sonner-toast]')) throw new Error('Toast still mounted')
  })
})

describe('交接常驻效果', () => {
  it('App 没有交接按钮与对话框，新 handoff 到达仍写草稿并切换目标；历史不触发', async () => {
    const history: SessionEntryRecord[] = [
      {
        sessionId: 's-1',
        seq: 1,
        kind: 'handoff',
        payloadVersion: 1,
        runId: 'old',
        createdAt: 1,
        payload: { targetSessionId: 's-4', instructions: 'old', summary: 'Old summary', target: 'current' },
      },
    ]
    const h = await mountApp(history)
    expect(document.querySelector('[data-action="open-handoff"]')).toBeNull()
    expect(document.querySelector('[data-action="more-header-actions"]')).toBeNull()
    expect(document.querySelector('[data-slot="handoff-dialog"]')).toBeNull()
    expect(h.chat.getState().activeSessionId).toBe('s-1')
    expect(h.writes).toEqual([])
    h.push('handoff', { targetSessionId: 's-3', instructions: 'next', summary: 'New summary', target: 'current' })
    await expect.poll(() => h.chat.getState().activeSessionId).toBe('s-3')
    expect(h.writes).toEqual([['s-3', 'New summary']])
    await h.screen.unmount()
  })

  it('失败只 Toast 一次；离开源会话后重试仍使用失败记录的目标与当前目录', async () => {
    const h = await mountApp()
    h.push('handoff_failed', { instructions: 'continue the exact next goal', summary: 'Ready summary', error: { code: 'worktree-exists', message: 'taken' } })
    const retry = page.getByRole('button', { name: 'Retry', exact: true })
    await expect.element(retry).toBeVisible()
    expect(document.querySelectorAll('[data-sonner-toast]').length).toBe(1)
    expect(document.querySelector('[data-sonner-toast]')?.textContent).toContain('A worktree with this name already exists')
    h.chat.getState().openSession('s-4')
    await expect.poll(() => h.chat.getState().activeSessionId).toBe('s-4')
    expect(document.querySelector('[data-slot="handoff-dialog"]')).toBeNull()
    await userEvent.click(retry)
    await expect.poll(() => h.starts).toEqual([{ sessionId: 's-1', instructions: 'continue the exact next goal', target: { kind: 'current' } }])
    expect(h.chat.getState().activeSessionId).toBe('s-4')
    toast.dismiss()
    await expect.poll(() => document.querySelector('[data-sonner-toast]')).toBeNull()
    h.push('handoff_failed', { instructions: 'another goal', summary: '', error: { code: 'git-failed', message: 'failed' } }, 'next-failure')
    await expect.element(retry).toBeVisible()
    expect(document.querySelectorAll('[data-sonner-toast]').length).toBe(1)
    toast.dismiss()
    await expect.poll(() => document.querySelector('[data-sonner-toast]')).toBeNull()
    await h.screen.unmount()
  })

  it('补发的失败历史不 Toast；离开源会话后成功仍写草稿但不切换', async () => {
    const h = await mountApp([
      {
        sessionId: 's-1',
        seq: 1,
        kind: 'handoff_failed',
        payloadVersion: 1,
        runId: 'old',
        createdAt: 1,
        payload: { instructions: 'old', summary: 'old', error: { code: 'worktree-exists', message: 'taken' } },
      },
    ])
    expect(document.querySelector('[data-sonner-toast]')).toBeNull()
    h.chat.getState().openSession('s-4')
    await expect.poll(() => h.chat.getState().activeSessionId).toBe('s-4')
    h.push('handoff', { targetSessionId: 's-3', instructions: 'next', summary: 'New summary', target: 'current' })
    await expect.poll(() => h.writes).toEqual([['s-3', 'New summary']])
    expect(h.chat.getState().activeSessionId).toBe('s-4')
    await h.screen.unmount()
  })
})

describe('时间线的交接行', () => {
  const record = (kind: string, payload: unknown): SessionEntryRecord => ({
    sessionId: 's-1',
    seq: 9,
    kind,
    payloadVersion: 1,
    payload,
    runId: null,
    createdAt: 1,
  })
  it('源：已交接到 <目标标题>（worktree），打开目标；目标：交接自 <源标题>，跳回源', async () => {
    const { chat } = createFixtureChat()
    await expect.poll(() => chat.lists.getState().listStatus).toBe('ready')
    const source = record('handoff', { targetSessionId: 's-3', instructions: 'i', summary: 's', target: 'worktree' })
    const origin = record('handoff_origin', { sessionId: 's-4', seq: 2 })
    const screen = await render(
      <I18nProvider locale="en">
        <ChatStoreProvider store={chat}>
          <HandoffRow item={{ kind: 'handoff', key: '1', handoff: { kind: 'source', payload: source.payload as never } }} />
          <HandoffRow item={{ kind: 'handoff', key: '2', handoff: { kind: 'origin', payload: origin.payload as never } }} />
        </ChatStoreProvider>
      </I18nProvider>,
    )
    await expect.element(screen.getByText('Handed off to SQLite 迁移与租约 (worktree)')).toBeInTheDocument()
    await expect.element(screen.getByText('Handed off from ripgrep contract tests')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(chat.getState().activeSessionId).toBe('s-3')
    await userEvent.click(screen.getByRole('button', { name: 'Back to the original session' }))
    expect(chat.getState().activeSessionId).toBe('s-4')
  })

  it('失败的交接（handoff_failed，没有目标）：显示没能创建与原因，不提供打开', async () => {
    const { chat } = createFixtureChat()
    await expect.poll(() => chat.lists.getState().listStatus).toBe('ready')
    const failed = record('handoff_failed', { error: { code: 'worktree-exists', message: 'taken' }, instructions: 'i', summary: 's' })
    const screen = await render(
      <I18nProvider locale="en">
        <ChatStoreProvider store={chat}>
          <HandoffRow item={{ kind: 'handoff', key: '1', handoff: { kind: 'failed', payload: failed.payload as never } }} />
        </ChatStoreProvider>
      </I18nProvider>,
    )
    const row = document.querySelector<HTMLElement>('[data-slot="handoff-row"]')!
    expect(row.dataset.handoff).toBe('failed')
    expect(row.textContent).toContain('The summary was written, but the new session could not be created')
    expect(row.textContent).toContain('A worktree with this name already exists')
    expect(screen.container.querySelector('[data-action="open-handoff-target"]')).toBeNull()
    expect(screen.container.querySelector('[data-action="open-handoff-source"]')).toBeNull()
    await page.getByRole('button', { name: 'Input / output', exact: true }).click()
    expect(row.textContent).toContain('summary')
  })
})

describe('目标会话的草稿', () => {
  it('writeSessionDraft 立即写入该会话的键；输入区编辑器接受该 EditorState，文本与摘要相同（含空行）', async () => {
    const items = new Map<string, string>()
    const drafts = createDraftStore({
      storage: { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => void items.set(k, v), removeItem: (k) => void items.delete(k) },
    })
    const summary = '## Context\nuse zod\n\n## Task\nbuild login'
    writeSessionDraft('s-9', summary, drafts)
    expect(items.has(draftKey({ sessionId: 's-9' }))).toBe(true)
    const handle = React.createRef<ComposerEditorHandle>()
    await render(<ComposerEditor ref={handle} label="Message" placeholder="Message" onSubmit={async () => false} />)
    await vi.waitFor(() => expect(handle.current).not.toBeNull())
    expect(handle.current!.setEditorState(drafts.load(draftKey({ sessionId: 's-9' })))).toBe(true)
    expect(handle.current!.getText()).toBe(summary)
    expect(handle.current!.setEditorState(textEditorState('one line'))).toBe(true)
    expect(handle.current!.getText()).toBe('one line')
  })
})
