// @ 菜单的两组：文件组在前、会话组在后，同一段查询同时过滤两组。会话候选来自传入的会话列表：同一范围（Project 或独立对话）、
// 未归档、不含当前会话，按最近更新排序；空查询 5 个，有查询时按标题匹配（前缀在前）最多 20 个。选中插入 Session Reference chip。
import '../../styles.css'
import type { Locale } from '@coko/i18n'
import type { Session, WorkspaceFileEntry } from '@coko/protocol'
import { ComposerEditor, type ComposerEditorHandle } from '@coko/ui'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { I18nProvider } from '../../app/i18n.tsx'
import { FileMenu, type FileMenuProps, type FetchWorkspaceFiles } from './file-menu.tsx'

const MINUTE = 60_000
type Row = [id: string, title: string, minutesAgo: number, patch?: Partial<Session>]
/** updatedAt 以"多少分钟前"给出（数字越小越新），相对渲染时刻计算，显示的相对时间不随文件运行时长漂移。 */
const sessionsAt = (now: number, rows: readonly Row[]): Session[] =>
  rows.map(([id, title, minutesAgo, patch]) => ({
    id,
    workspaceId: 'w-1',
    projectId: 'p-1',
    pinnedAt: null,
    archivedAt: null,
    title,
    model: null,
    thinkingLevel: 'off',
    modelCleared: false,
    running: false,
    activity: 'idle',
    createdAt: 1,
    updatedAt: now - minutesAgo * MINUTE,
    ...patch,
  }))

const ROWS: Row[] = [
  ['s-current', 'Current work', 0],
  ['s-old-plan', 'Plan the migration', 50 * 60],
  ['s-deploy', 'Deploy pipeline', 5],
  ['s-auth', 'Auth refactor', 10],
  ['s-untitled', '', 20],
  ['s-docs', 'Docs cleanup', 30],
  ['s-perf', 'Perf pass', 40],
  ['s-seventh', 'Seventh oldest', 60 * 24 * 3],
  ['s-other', 'Other project plan', 1, { projectId: 'p-2' }],
  ['s-solo', 'Standalone plan', 2, { projectId: null }],
  ['s-archived', 'Archived plan', 3, { archivedAt: 1 }],
]
const FILES = ['src/', 'src/plan.ts', 'README.md']

const fetchFiles: FetchWorkspaceFiles = async (_workspaceId, query) =>
  FILES.filter((path) => path.toLowerCase().includes(query.toLowerCase())).map((path): WorkspaceFileEntry => ({
    path,
    kind: path.endsWith('/') ? 'directory' : 'file',
  }))

async function setup({ rows = ROWS, locale = 'en', ...props }: Partial<FileMenuProps> & { rows?: readonly Row[]; locale?: Locale } = {}) {
  const handle = React.createRef<ComposerEditorHandle>()
  const onSubmit = vi.fn<(text: string) => boolean>(() => true)
  await render(
    <I18nProvider locale={locale}>
      <div style={{ width: 480, padding: '480px 16px 16px' }}>
        <ComposerEditor ref={handle} label="Task" placeholder="Give Coko a task" onSubmit={onSubmit}>
          <FileMenu workspaceId="w-1" fetchFiles={fetchFiles} sessions={sessionsAt(Date.now(), rows)} projectId="p-1" sessionId="s-current" {...props} />
        </ComposerEditor>
      </div>
    </I18nProvider>,
  )
  await editor().click()
  return { handle, onSubmit }
}

const editor = () => page.getByRole('textbox', { name: 'Task' })
const root = () => editor().element() as HTMLElement
const menu = () => document.querySelector<HTMLElement>('[role="listbox"]:not([aria-hidden="true"])')
const options = () => [...(menu()?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]
const groups = () =>
  [...(menu()?.querySelectorAll<HTMLElement>('[role="group"]') ?? [])].map((group) => ({
    heading: document.getElementById(group.getAttribute('aria-labelledby')!)!.textContent,
    options: [...group.querySelectorAll<HTMLElement>('[role="option"]')].map((option) => option.textContent),
  }))
const chips = () => [...root().querySelectorAll<HTMLElement>('[data-session-reference]')].map((chip) => [chip.dataset.sessionReference, chip.textContent])

const FILE_GROUP = { heading: 'Files and folders', options: ['src/', 'src/plan.ts', 'README.md'] }

describe('@ 菜单的会话组', () => {
  it('文件组在前、会话组在后；空查询列出同一 Project 最近更新的 5 个会话，另一个 Project、独立对话、归档与当前会话不出现', async () => {
    await setup()
    await userEvent.keyboard('@')
    await expect
      .poll(groups)
      .toEqual([
        FILE_GROUP,
        { heading: 'Sessions', options: ['Deploy pipeline5m ago', 'Auth refactor10m ago', 'Untitled20m ago', 'Docs cleanup30m ago', 'Perf pass40m ago'] },
      ])
    expect(menu()!.getAttribute('aria-label')).toBe('Files and sessions')
  })

  it('同一段查询同时过滤两组；会话按标题匹配，不区分大小写，前缀在前、包含在后，各自按最近更新排序', async () => {
    await setup()
    await userEvent.keyboard('@P')
    await expect.poll(groups).toEqual([
      { heading: 'Files and folders', options: ['src/plan.ts'] },
      { heading: 'Sessions', options: ['Perf pass40m ago', 'Plan the migration2d ago', 'Deploy pipeline5m ago', 'Docs cleanup30m ago'] },
    ])
  })

  it('有查询时最多列出 20 个会话', async () => {
    const rows = Array.from({ length: 25 }, (_, i): Row => [`s-${i}`, `bulk ${String(i).padStart(2, '0')}`, i + 1])
    await setup({ rows })
    await userEvent.keyboard('@bulk')
    await expect.poll(() => options().length).toBe(20)
    expect(options()[0]!.textContent).toBe('bulk 001m ago')
    expect(options()[19]!.textContent).toBe('bulk 1920m ago')
  })

  it('只有一组有匹配时只显示那一组；两组都没有匹配时菜单不出现，Enter 照常提交', async () => {
    const { onSubmit } = await setup()
    await userEvent.keyboard('@sev')
    await expect.poll(groups).toEqual([{ heading: 'Sessions', options: ['Seventh oldest3d ago'] }])
    await userEvent.keyboard('{Backspace}{Backspace}{Backspace}readme')
    await expect.poll(groups).toEqual([{ heading: 'Files and folders', options: ['README.md'] }])
    await userEvent.keyboard('{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}zzz')
    await expect.poll(menu).toBeNull()
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => onSubmit.mock.calls).toEqual([['@zzz']])
  })

  it('有查询时会话组不抢在文件结果之前：这次查询的文件结果返回前菜单不以会话组单独打开，返回后文件在前、Enter 选中文件；请求失败或无匹配时只显示会话组', async () => {
    const pending: { query: string; resolve: (files: WorkspaceFileEntry[]) => void; reject: (error: Error) => void }[] = []
    const deferred: FetchWorkspaceFiles = (_workspaceId, query) => new Promise((resolve, reject) => pending.push({ query, resolve, reject }))
    const requested = async (query: string) => {
      await expect.poll(() => pending.at(-1)?.query).toBe(query)
    }
    await setup({ rows: [['s-src', 'src cleanup', 5]], fetchFiles: deferred })

    // 输入快于文件请求：标题含 src 的会话已经匹配，但文件结果未知，菜单里没有任何可选项（Enter 选不到会话）。
    // 断言选项而不是 listbox 容器：最后一次按键让菜单变空、其后没有再渲染时，空容器的 aria-hidden 可能还没有写回。
    await userEvent.keyboard('@src')
    await requested('src')
    await expect.poll(options).toEqual([])
    pending.at(-1)!.resolve([
      { path: 'src/', kind: 'directory' },
      { path: 'src/plan.ts', kind: 'file' },
    ])
    await expect.poll(groups).toEqual([
      { heading: 'Files and folders', options: ['src/', 'src/plan.ts'] },
      { heading: 'Sessions', options: ['src cleanup5m ago'] },
    ])
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => root().querySelector('[data-file-reference]')?.textContent).toBe('@src/')
    expect(chips()).toEqual([])

    // 请求失败：上一次的文件结果过滤后没有匹配，失败后只显示会话组。
    await userEvent.keyboard('@cle')
    await requested('cle')
    await expect.poll(options).toEqual([])
    pending.at(-1)!.reject(new Error('offline'))
    await expect.poll(groups).toEqual([{ heading: 'Sessions', options: ['src cleanup5m ago'] }])

    // 这次查询没有文件匹配：同样只显示会话组。
    await userEvent.keyboard('{Backspace}{Backspace}{Backspace}ean')
    await requested('ean')
    await expect.poll(options).toEqual([])
    pending.at(-1)!.resolve([])
    await expect.poll(groups).toEqual([{ heading: 'Sessions', options: ['src cleanup5m ago'] }])
    await userEvent.keyboard('{Escape}')
  })

  it('独立对话只列其他独立对话；没有 Workspace 时不请求文件，只有会话组', async () => {
    const fetch = vi.fn<FetchWorkspaceFiles>(fetchFiles)
    await setup({ workspaceId: undefined, projectId: null, sessionId: undefined, fetchFiles: fetch })
    await userEvent.keyboard('@')
    await expect.poll(groups).toEqual([{ heading: 'Sessions', options: ['Standalone plan2m ago'] }])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('没有可引用的会话时菜单与只有文件时相同', async () => {
    await setup({ rows: [ROWS[0]!, ROWS[8]!, ROWS[10]!] })
    await userEvent.keyboard('@')
    await expect.poll(groups).toEqual([FILE_GROUP])
  })

  it('没有给出会话范围时不显示会话组', async () => {
    await setup({ projectId: undefined })
    await userEvent.keyboard('@')
    await expect.poll(groups).toEqual([FILE_GROUP])
  })

  it('Enter、Tab 与指针选中会话都插入 chip：显示选中时的标题（无标题的会话显示占位标题），读出的文本为 @session:<id>', async () => {
    const { handle } = await setup()
    await userEvent.keyboard('@untit')
    await expect.poll(() => options().map((o) => o.textContent)).toEqual(['Untitled20m ago'])
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard('@auth')
    await expect.poll(() => options().map((o) => o.textContent)).toEqual(['Auth refactor10m ago'])
    await userEvent.keyboard('{Tab}')
    await userEvent.keyboard('@depl')
    await expect.poll(() => options().map((o) => o.textContent)).toEqual(['Deploy pipeline5m ago'])
    await userEvent.click(options()[0]!)
    await expect.poll(chips).toEqual([
      ['s-untitled', '@Untitled'],
      ['s-auth', '@Auth refactor'],
      ['s-deploy', '@Deploy pipeline'],
    ])
    expect(handle.current!.getText()).toBe('@session:s-untitled @session:s-auth @session:s-deploy ')
    await expect.element(editor()).toHaveFocus()
  })

  it('标题放不下时截断，最近活动时间仍完整显示在条目内', async () => {
    await setup({ rows: [['s-long', 'A very long session title that keeps going '.repeat(4).trim(), 7]] })
    await userEvent.keyboard('@very')
    await expect.poll(() => options().length).toBe(1)
    const option = options()[0]!
    const [title, time] = [...option.querySelectorAll<HTMLElement>('span > span > span')]
    expect(time!.textContent).toBe('7m ago')
    expect(title!.scrollWidth).toBeGreaterThan(title!.clientWidth)
    const row = option.getBoundingClientRect()
    const timeBox = time!.getBoundingClientRect()
    expect(timeBox.width).toBeGreaterThan(0)
    expect(timeBox.right).toBeLessThanOrEqual(row.right)
    expect(timeBox.left).toBeGreaterThanOrEqual(title!.getBoundingClientRect().right)
  })

  it('中文界面：组名、列表名称与时间使用中文文案', async () => {
    await setup({ locale: 'zh' })
    await userEvent.keyboard('@dep')
    await expect.poll(groups).toEqual([{ heading: '会话', options: ['Deploy pipeline5 分钟前'] }])
    expect(menu()!.getAttribute('aria-label')).toBe('文件与会话')
  })
})
