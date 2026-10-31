// 交接的界面（docs/subsystems/handoff.md）：对话框（下一步目标、目标目录、未提交改动提示、错误、进行中与停止、⌘↩ 提交）、时间线的交接行
// （打开目标与跳回源），以及写入目标会话的草稿能被输入区读出（纯文本 EditorState）。
import '../../styles.css'
import type { HandoffTarget, SessionEntryRecord, Worktree } from '@coko/protocol'
import { ComposerEditor, TooltipProvider, type ComposerEditorHandle } from '@coko/ui'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { ChatStoreProvider } from '../../app/chat.tsx'
import { I18nProvider } from '../../app/i18n.tsx'
import { ApiError } from '../../client/api.ts'
import { createDraftStore, draftKey, textEditorState, writeSessionDraft } from '../../stores/draft-store.ts'
import { createHandoffStore, type HandoffBackend } from '../../stores/handoff-store.ts'
import { createWorktreesStore } from '../../stores/worktrees-store.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'
import { HandoffDialog, HandoffStoresProvider } from './handoff-dialog.tsx'
import { HandoffRow } from './handoff-row.tsx'

const worktree: Worktree = {
  id: 'wt1',
  workspaceId: 'w-coko',
  name: 'login',
  path: '/Users/me/coko/.coko-worktrees/login',
  branch: 'coko/login',
  baseCommit: 'abc',
  status: 'active',
  createdBy: 'user',
  sessionCount: 1,
}

async function mountDialog(options: { backend?: Partial<HandoffBackend>; repo?: boolean; dirty?: number } = {}) {
  const fixture = createFixtureChat()
  await expect.poll(() => fixture.chat.getState().listStatus).toBe('ready')
  const starts: { sessionId: string; instructions: string; target: HandoffTarget }[] = []
  const stops: string[] = []
  const handoff = createHandoffStore({
    backend: {
      start: async (sessionId, input) => {
        starts.push({ sessionId, ...input })
        return { runId: 'h1' }
      },
      gitStatus: async () => ({ repo: options.repo ?? true, ...(options.repo === false ? {} : { branch: 'main' }), dirtyFiles: options.dirty ?? 0 }),
      stop: async (sessionId) => void stops.push(sessionId),
      ...options.backend,
    },
    writeDraft: () => {},
  })
  const worktrees = createWorktreesStore({
    list: async () => [worktree],
    create: async () => worktree,
    createSession: async () => ({}) as never,
    remove: async () => {},
  })
  const screen = await render(
    <I18nProvider locale="en">
      <ChatStoreProvider store={fixture.chat}>
        <HandoffStoresProvider handoff={handoff} worktrees={worktrees}>
          <TooltipProvider>
            <HandoffDialog sessionId="s-1" open onClose={() => {}} />
          </TooltipProvider>
        </HandoffStoresProvider>
      </ChatStoreProvider>
    </I18nProvider>,
  )
  const dialog = () => document.querySelector('[data-slot="handoff-dialog"]') as HTMLElement
  return { ...fixture, handoff, starts, stops, dialog, unmount: () => screen.unmount() }
}

describe('交接对话框', () => {
  it('未提交改动提示（按目标不同措辞）；新 worktree 带名称提交；⌘↩ 提交；之后显示进行中，可停止', async () => {
    const h = await mountDialog({ dirty: 3 })
    await expect.poll(() => h.dialog()?.querySelector('[data-slot="handoff-dirty"]')?.getAttribute('data-count')).toBe('3')
    expect(h.dialog().querySelector('[data-slot="handoff-dirty"]')!.textContent).toContain('works in the same directory')
    const submit = page.getByRole('button', { name: 'Hand off', exact: true })
    await expect.element(submit).toBeDisabled()
    await userEvent.fill(page.getByRole('textbox', { name: 'Next goal' }), 'build the login page')
    await userEvent.click(page.getByRole('radio', { name: 'New worktree' }))
    expect(h.dialog().querySelector('[data-slot="handoff-dirty"]')!.textContent).toContain('not copied to the worktree')
    await userEvent.fill(page.getByRole('textbox', { name: 'Worktree name (optional)' }), 'login-2')
    await userEvent.click(page.getByRole('textbox', { name: 'Next goal' }))
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    await expect.poll(() => h.starts).toEqual([{ sessionId: 's-1', instructions: 'build the login page', target: { kind: 'new-worktree', name: 'login-2' } }])
    await expect.poll(() => h.dialog().getAttribute('data-phase')).toBe('summarizing')
    const progress = h.dialog().querySelector('[data-slot="handoff-progress"]')!
    expect(progress.getAttribute('role')).toBe('status')
    expect(progress.textContent).toContain('Writing the handoff summary…')
    await userEvent.click(page.getByRole('button', { name: 'Stop' }))
    expect(h.stops).toEqual(['s-1'])
  })

  it('已有 worktree：列出 active 的 worktree 并以其 id 提交；不在 git 仓库时只能选当前目录', async () => {
    const h = await mountDialog()
    await userEvent.fill(page.getByRole('textbox', { name: 'Next goal' }), 'next')
    const existing = page.getByRole('radio', { name: 'Existing worktree' })
    await expect.element(existing).toBeEnabled()
    await userEvent.click(existing)
    await expect.element(page.getByRole('radio', { name: 'coko/login' })).toBeInTheDocument()
    await userEvent.click(page.getByRole('button', { name: 'Hand off', exact: true }))
    await expect.poll(() => h.starts.map((s) => s.target)).toEqual([{ kind: 'worktree', worktreeId: 'wt1' }])

    await h.unmount()
    const plain = await mountDialog({ repo: false, dirty: 0 })
    await expect.element(page.getByText('This workspace is not in a git repository; you can only hand off to the current directory')).toBeInTheDocument()
    await expect.element(page.getByRole('radio', { name: 'New worktree' })).toBeDisabled()
    expect(plain.dialog().querySelector('[data-slot="handoff-dirty"]')).toBeNull()
  })

  it('摘要之后目标没能创建（failed）：显示错误与原因、可复制摘要、以"重试"重新提交；不再停在创建中', async () => {
    const h = await mountDialog()
    await userEvent.fill(page.getByRole('textbox', { name: 'Next goal' }), 'next')
    h.handoff.setState({
      progress: { 's-1': { phase: 'failed', runId: 'h1', error: { code: 'worktree-exists', message: 'fatal: exists' }, summary: '## Task\nnext' } },
    })
    await expect.poll(() => h.dialog().getAttribute('data-phase')).toBe('failed')
    expect(h.dialog().querySelector('[data-slot="handoff-progress"]')).toBeNull()
    const alert = h.dialog().querySelector('[data-slot="handoff-failed"]')!
    expect(alert.getAttribute('role')).toBe('alert')
    expect(alert.textContent).toContain('The summary was written, but the new session could not be created')
    expect(alert.textContent).toContain('A worktree with this name already exists')
    await expect.element(page.getByRole('textbox', { name: 'Next goal' })).toHaveValue('next')

    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    try {
      await userEvent.click(page.getByRole('button', { name: 'Copy summary' }))
      await expect.poll(() => writeText.mock.calls).toEqual([['## Task\nnext']])
    } finally {
      writeText.mockRestore()
    }

    await userEvent.click(page.getByRole('button', { name: 'Retry', exact: true }))
    await expect.poll(() => h.starts.map((s) => s.instructions)).toEqual(['next'])
    await expect.poll(() => h.dialog().getAttribute('data-phase')).toBe('summarizing')
  })

  it('失败的错误码未知、没有摘要时只显示概括，不提供复制', async () => {
    const h = await mountDialog()
    h.handoff.setState({ progress: { 's-1': { phase: 'failed', runId: 'h1', error: { code: 'git-failed' } } } })
    await expect.poll(() => h.dialog().getAttribute('data-phase')).toBe('failed')
    const alert = h.dialog().querySelector('[data-slot="handoff-failed"]')!
    expect(alert.textContent).toBe('The summary was written, but the new session could not be created')
    expect(h.dialog().querySelector('[data-action="copy-handoff-summary"]')).toBeNull()
  })

  it('Sidecar 拒绝时显示本地化的原因，输入保留', async () => {
    await mountDialog({ backend: { start: async () => Promise.reject(new ApiError('nothing-to-hand-off', 'x', 400)) } })
    await userEvent.fill(page.getByRole('textbox', { name: 'Next goal' }), 'next')
    await userEvent.click(page.getByRole('button', { name: 'Hand off', exact: true }))
    await expect.element(page.getByRole('alert')).toHaveTextContent('This session has nothing to hand off yet')
    await expect.element(page.getByRole('textbox', { name: 'Next goal' })).toHaveValue('next')
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
    await expect.poll(() => chat.getState().listStatus).toBe('ready')
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

  it('失败的交接（status failed，没有目标）：显示没能创建与原因，不提供打开', async () => {
    const { chat } = createFixtureChat()
    await expect.poll(() => chat.getState().listStatus).toBe('ready')
    const failed = record('handoff', { status: 'failed', error: { code: 'worktree-exists' }, instructions: 'i', summary: 's', target: 'worktree' })
    const screen = await render(
      <I18nProvider locale="en">
        <ChatStoreProvider store={chat}>
          <HandoffRow item={{ kind: 'handoff', key: '1', handoff: { kind: 'source', payload: failed.payload as never } }} />
        </ChatStoreProvider>
      </I18nProvider>,
    )
    const row = document.querySelector<HTMLElement>('[data-slot="handoff-row"]')!
    expect(row.dataset.handoff).toBe('failed')
    expect(row.textContent).toContain('The summary was written, but the new session could not be created')
    expect(row.textContent).toContain('A worktree with this name already exists')
    expect(screen.container.querySelector('button')).toBeNull()
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
