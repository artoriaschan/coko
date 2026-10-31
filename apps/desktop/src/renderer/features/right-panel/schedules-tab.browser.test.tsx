// 定时任务视图（docs/subsystems/schedules.md#界面）：列表的规则描述、下次时间与时区、状态与最近结果；表单的行内校验与 cron 的接下来 3 次、
// 时区下拉（缺省本机时区）；暂停 / 恢复 / 删除（确认）与 revision 冲突读回；投递历史与时间线的 schedule_fire 行；明暗主题、390 px 与键盘。
import '../../styles.css'
import { ScheduleRuleError } from '@coko/agent/entries'
import type { Schedule, SessionEntryRecord } from '@coko/protocol'
import { TooltipProvider } from '@coko/ui'
import type * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { ChatStoreProvider } from '../../app/chat.tsx'
import { I18nProvider } from '../../app/i18n.tsx'
import { ApiError } from '../../client/api.ts'
import { createSchedulesStore, type SchedulesBackend, type SchedulesStore } from '../../stores/schedules-store.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'
import { localTimeZone, SchedulesStoreProvider } from '../conversation/schedules-button.tsx'
import { ScheduleFireRow } from '../conversation/schedule-fire-row.tsx'
import { SchedulesButton } from '../conversation/schedules-button.tsx'
import { visibleHeaderActions } from '../conversation/header-actions.ts'
import { SchedulesTab } from './schedules-tab.tsx'
import { visibleRightPanelTabs } from './tabs.ts'

const NOV2_9_UTC = Date.parse('2026-11-02T09:00:00Z')

const schedule = (id: string, patch: Partial<Schedule> = {}): Schedule => ({
  id,
  sessionId: 's-1',
  title: `Task ${id}`,
  prompt: 'check the build',
  rule: { kind: 'cron', expression: '0 9 * * *', timeZone: 'UTC' },
  status: 'active',
  nextAt: NOV2_9_UTC,
  revision: 1,
  ...patch,
})

/** 内存后端：revision 规则与 Sidecar 相同；创建时按 Sidecar 校验规则（同一实现）。 */
function backend(initial: Schedule[]) {
  const rows = new Map(initial.map((s) => [s.id, s]))
  const updates: { id: string; patch: unknown }[] = []
  let next = 1
  const api: SchedulesBackend = {
    list: async (sessionId) => [...rows.values()].filter((s) => sessionId === undefined || s.sessionId === sessionId),
    create: async (sessionId, input) => {
      const created = schedule(`new-${next++}`, { sessionId, ...input, nextAt: Date.now() + 60_000 })
      rows.set(created.id, created)
      return created
    },
    update: async (id, patch) => {
      updates.push({ id, patch })
      const row = rows.get(id)!
      if (row.revision !== patch.revision) throw new ApiError('revision-conflict', 'conflict', 409, { expected: patch.revision, actual: row.revision })
      const { revision: _r, ...rest } = patch
      const updated: Schedule = { ...row, ...rest, revision: row.revision + 1 }
      rows.set(id, updated)
      return updated
    },
    remove: async (id) => void rows.delete(id),
  }
  const external = (id: string, patch: Partial<Schedule>) => rows.set(id, { ...rows.get(id)!, ...patch, revision: rows.get(id)!.revision + 1 })
  return { api, rows, updates, external }
}

let seq = 1000
const fireEntry = (scheduleId: string, payload: Partial<SessionEntryRecord['payload'] & object>): SessionEntryRecord => ({
  sessionId: 's-1',
  seq: ++seq,
  kind: 'schedule_fire',
  payloadVersion: 1,
  payload: { scheduleId, occurrence: NOV2_9_UTC, status: 'started', ...payload },
  runId: null,
  createdAt: seq,
})

function mount(store: SchedulesStore, node: React.ReactNode, options: { entries?: SessionEntryRecord[]; locale?: 'en' | 'zh'; width?: number } = {}) {
  const { chat } = createFixtureChat({ entries: { 's-1': options.entries ?? [] } })
  void chat.getState().subscribeSession('s-1')
  return render(
    <I18nProvider locale={options.locale ?? 'en'}>
      <ChatStoreProvider store={chat}>
        <SchedulesStoreProvider store={store}>
          <TooltipProvider>
            <div className="flex flex-col bg-background text-foreground" style={{ width: options.width ?? 420, height: 640 }}>
              {node}
            </div>
          </TooltipProvider>
        </SchedulesStoreProvider>
      </ChatStoreProvider>
    </I18nProvider>,
  )
}

const row = (id: string) => document.querySelector<HTMLElement>(`[data-slot="schedules-tab"] li[data-schedule-id="${id}"]`)
const dialog = () => page.getByRole('dialog')
/** Radix 对话框关闭后才结束用例（共用 setup 断言没有遗留的模态层）。 */
const closed = async () => {
  await expect.poll(() => document.querySelector('[role="dialog"]')).toBeNull()
}

afterEach(async () => {
  document.documentElement.classList.remove('dark')
  await page.viewport(1280, 800)
})

describe('注册表', () => {
  it('Schedules tab 与标题栏"定时任务"按钮已交付', () => {
    expect(visibleRightPanelTabs().map((t) => t.id)).toContain('schedules')
    expect(visibleHeaderActions().map((a) => a.id)).toContain('schedules')
  })
})

describe('标题栏按钮', () => {
  it('没有任务时不显示；有任务时显示，徽标只计 active；点击打开 Schedules tab', async () => {
    const { api, rows } = backend([])
    const store = createSchedulesStore(api)
    const opened: string[] = []
    await mount(store, <SchedulesButton sessionId="s-1" openTab={(tab) => opened.push(tab)} />)
    await expect.poll(() => store.getState().lists['s-1']?.status).toBe('ready')
    expect(document.querySelector('[data-action="open-schedules"]')).toBeNull()
    rows.set('a', schedule('a'))
    rows.set('b', schedule('b', { status: 'paused' }))
    await store.getState().load('s-1')
    await expect.poll(() => document.querySelector('[data-action="open-schedules"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="schedules-badge"]')?.textContent).toBe('1')
    await userEvent.click(page.getByRole('button', { name: 'Scheduled tasks (1 active)' }))
    expect(opened).toEqual(['schedules'])
    // 设置的"打开会话"：待打开的会话只取一次。
    store.getState().requestOpen('s-1')
    await expect.poll(() => opened).toEqual(['schedules', 'schedules'])
    expect(store.getState().pendingOpen).toBeNull()
  })
})

describe('列表', () => {
  it('规则的本地化描述（after、at、every、cron）、下次时间与时区、状态与最近结果', async () => {
    const { api } = backend([
      schedule('cron', { lastFire: { status: 'started', runId: 'r1' } }),
      schedule('every', { rule: { kind: 'every', seconds: 1800 }, lastFire: { status: 'skipped', reason: 'budget' } }),
      schedule('after', {
        rule: { kind: 'after', seconds: 90 },
        status: 'inactive',
        nextAt: undefined,
        lastFire: { status: 'skipped', reason: 'worktree-removed' },
      }),
      schedule('at', { rule: { kind: 'at', at: '2026-11-03T09:00:00Z' }, status: 'paused' }),
    ])
    await mount(createSchedulesStore(api), <SchedulesTab sessionId="s-1" />)
    await expect.poll(() => row('at')).not.toBeNull()
    const text = (id: string, slot: string) => row(id)!.querySelector(`[data-slot="${slot}"]`)!.textContent
    expect(text('cron', 'schedule-rule')).toBe('Cron 0 9 * * *')
    expect(text('cron', 'schedule-next')).toBe('Next Nov 2, 2026, 9:00 AM (UTC)')
    expect(text('cron', 'schedule-last')).toBe('Last run: started')
    expect(row('cron')!.textContent).toContain('Active')
    expect(text('every', 'schedule-rule')).toBe('Every 30 min')
    // 非 cron 的规则按本机时区显示，并注明时区名。
    expect(text('every', 'schedule-next')).toContain(`(${localTimeZone()})`)
    expect(text('every', 'schedule-last')).toBe('Last run: skipped, the Goal budget is used up')
    expect(text('after', 'schedule-rule')).toBe('Once, 90 s after creation')
    expect(text('after', 'schedule-next')).toBe('No next run')
    expect(text('after', 'schedule-last')).toBe('Last run: skipped, the worktree was removed')
    expect(row('after')!.textContent).toContain('Ended')
    expect(text('at', 'schedule-rule')).toMatch(/^Once at Nov 3, 2026, /)
    expect(text('at', 'schedule-next')).toBe('No next run')
    expect(text('at', 'schedule-last')).toBe("Hasn't run yet")
    expect(row('at')!.textContent).toContain('Paused')
    // 暂停的有"恢复"，active 的有"暂停"，已结束的两者都没有。
    expect(row('at')!.querySelector('[data-action="resume-schedule"]')).not.toBeNull()
    expect(row('cron')!.querySelector('[data-action="pause-schedule"]')).not.toBeNull()
    expect(row('after')!.querySelector('[data-action="pause-schedule"], [data-action="resume-schedule"]')).toBeNull()
  })

  it('中文：规则、状态与跳过原因', async () => {
    const { api } = backend([schedule('every', { rule: { kind: 'every', seconds: 7200 }, lastFire: { status: 'skipped', reason: 'model-not-configured' } })])
    await mount(createSchedulesStore(api), <SchedulesTab sessionId="s-1" />, { locale: 'zh' })
    await expect.poll(() => row('every')).not.toBeNull()
    expect(row('every')!.querySelector('[data-slot="schedule-rule"]')!.textContent).toBe('每 2 小时')
    expect(row('every')!.querySelector('[data-slot="schedule-last"]')!.textContent).toBe('最近一次：已跳过，没有配置模型')
    expect(row('every')!.textContent).toContain('启用')
  })

  it('投递历史：选中项的 schedule_fire 条目（新的在前），含跳过原因与合并的错过次数', async () => {
    const { api } = backend([schedule('a'), schedule('b')])
    const entries = [
      fireEntry('a', { status: 'started', runId: 'r1' }),
      fireEntry('b', { status: 'started' }),
      fireEntry('a', { status: 'skipped', reason: 'disabled', occurrence: NOV2_9_UTC + 86_400_000, missed: 3 }),
    ]
    await mount(createSchedulesStore(api), <SchedulesTab sessionId="s-1" />, { entries })
    await expect.poll(() => row('a')).not.toBeNull()
    await userEvent.click(row('a')!.querySelector<HTMLElement>('[data-action="select-schedule"]')!)
    await expect.poll(() => document.querySelector('[data-slot="schedule-history"]')?.getAttribute('data-schedule-id')).toBe('a')
    await expect.poll(() => document.querySelectorAll('[data-slot="schedule-history-item"]').length).toBe(2)
    const items = [...document.querySelectorAll('[data-slot="schedule-history-item"]')].map((el) => el.textContent)
    expect(items[0]).toContain('Scheduled task skipped · scheduled tasks are turned off in settings')
    expect(items[0]).toContain('3 missed runs merged')
    expect(items[1]).toContain('Scheduled task started')
  })
})

describe('表单', () => {
  async function openNew(store: SchedulesStore) {
    await mount(store, <SchedulesTab sessionId="s-1" />)
    await userEvent.click(page.getByRole('button', { name: 'New' }))
    await expect.element(dialog()).toBeVisible()
  }
  const errors = () => [...document.querySelectorAll('[data-slot="field-error"]')].map((el) => el.textContent)

  it('cron：输入时显示接下来 3 次；非法时行内错误、没有预览；时区下拉缺省本机时区，可改为 UTC', async () => {
    const { api } = backend([])
    await openNew(createSchedulesStore(api))
    const picker = document.querySelector<HTMLElement>('[data-slot="time-zone-picker"]')!
    expect(picker.dataset.value).toBe(localTimeZone())
    expect(picker.textContent).toContain(localTimeZone())
    const cron = page.elementLocator(document.querySelector('input[name="schedule-cron"]')!)
    expect(cron.element().getAttribute('aria-describedby')).toBeTruthy()
    await cron.fill('0 9 * * *')
    const upcoming = () => [...document.querySelectorAll<HTMLElement>('[data-slot="schedule-upcoming"] li')].map((li) => Number(li.dataset.at))
    await expect.poll(() => upcoming().length).toBe(3)
    // 每天一次：相邻两次相隔 24 小时（本机时区若跨夏令时为 23 / 25 小时）。
    const [a, b, c] = upcoming()
    expect([b! - a!, c! - b!].every((d) => Math.abs(d - 86_400_000) <= 3_600_000)).toBe(true)
    expect(a).toBeGreaterThan(Date.now())

    await cron.fill('61 * * * *')
    await expect.poll(errors).toEqual(['Invalid cron expression'])
    expect(document.querySelector('[data-slot="schedule-upcoming"]')).toBeNull()
    expect(cron.element().getAttribute('aria-invalid')).toBe('true')
    await cron.fill('30 1 * * *')
    await expect.poll(errors).toEqual([])

    await userEvent.click(page.getByRole('button', { name: 'Time zone', exact: true }))
    await userEvent.click(page.getByRole('menuitemradio', { name: 'UTC', exact: true }))
    await expect.poll(() => document.querySelector<HTMLElement>('[data-slot="time-zone-picker"]')!.dataset.value).toBe('UTC')
    await expect.poll(() => upcoming().map((at) => new Date(at).toISOString().slice(11))).toEqual(['01:30:00.000Z', '01:30:00.000Z', '01:30:00.000Z'])
    await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull()
    await userEvent.click(dialog().getByRole('button', { name: 'Cancel', exact: true }))
    await closed()
  })

  it('间隔小于 1 分钟、非整数分钟、一次性时刻在过去：提交时行内错误，不发请求', async () => {
    const { api, rows } = backend([])
    await openNew(createSchedulesStore(api))
    await page.getByRole('textbox', { name: 'Title' }).fill('poll')
    await page.getByRole('textbox', { name: 'Prompt' }).fill('look at the queue')
    await userEvent.click(page.getByRole('radio', { name: 'Interval' }))
    const minutes = page.getByRole('spinbutton', { name: 'Interval (minutes)' })
    await minutes.fill('0')
    await userEvent.click(page.getByRole('button', { name: 'Create' }))
    await expect.poll(errors).toEqual(['The interval must be at least 1 minute'])
    await minutes.fill('1.5')
    await expect.poll(errors).toEqual(['Enter a whole number of minutes'])
    await minutes.fill('10')
    await expect.poll(errors).toEqual([])
    expect(document.querySelectorAll('[data-slot="schedule-upcoming"] li')).toHaveLength(3)

    await userEvent.click(page.getByRole('radio', { name: 'Once' }))
    const at = document.querySelector<HTMLInputElement>('input[name="schedule-at"]')!
    await page.elementLocator(at).fill('2020-01-01T09:00')
    await userEvent.click(page.getByRole('button', { name: 'Create' }))
    await expect.poll(errors).toEqual(['The time must be in the future'])
    expect(at.getAttribute('aria-invalid')).toBe('true')
    expect(rows.size).toBe(0)
    await userEvent.keyboard('{Escape}')
    await closed()
  })

  it('标题与指令为空时提交给出行内错误；对手：校验与 Sidecar 同源（every 30 秒同样被 upcomingOccurrences 拒绝）', async () => {
    const { api } = backend([])
    await openNew(createSchedulesStore(api))
    await page.getByRole('textbox', { name: 'Title' }).fill('   ')
    await userEvent.click(page.getByRole('button', { name: 'Create' }))
    await expect.poll(errors).toEqual(['Enter a title', 'Enter a prompt'])
    const { upcomingOccurrences } = await import('@coko/agent/entries')
    expect(() => upcomingOccurrences({ kind: 'every', seconds: 30 }, Date.now(), 3)).toThrow(ScheduleRuleError)
    await userEvent.keyboard('{Escape}')
    await closed()
  })

  it('键盘：Tab 到"新建"、Enter 打开、填写并以 Enter 提交，新任务出现在列表并被选中', async () => {
    const { api, rows } = backend([])
    await mount(createSchedulesStore(api), <SchedulesTab sessionId="s-1" />)
    const create = page.getByRole('button', { name: 'New' })
    await expect.element(create).toBeVisible()
    ;(create.element() as HTMLElement).focus()
    await userEvent.keyboard('{Enter}')
    await expect.element(dialog()).toBeVisible()
    // 标题自动获得焦点。
    expect(document.activeElement?.getAttribute('name')).toBe('schedule-title')
    await userEvent.keyboard('nightly')
    await userEvent.keyboard('{Tab}')
    await userEvent.keyboard('run the nightly checks')
    ;(document.querySelector('input[name="schedule-title"]') as HTMLElement).focus()
    await userEvent.keyboard('{Enter}')
    await closed()
    expect([...rows.values()].map((s) => [s.title, s.prompt, s.rule])).toEqual([
      ['nightly', 'run the nightly checks', { kind: 'cron', expression: '0 9 * * *', timeZone: localTimeZone() }],
    ])
    await expect.poll(() => row('new-1')?.getAttribute('aria-current')).toBe('true')
  })

  it('编辑：只发送改动的字段；revision 冲突时行内提示、保留输入并读回，再次保存成功', async () => {
    const { api, external, updates, rows } = backend([schedule('a')])
    await mount(createSchedulesStore(api), <SchedulesTab sessionId="s-1" />)
    await expect.poll(() => row('a')).not.toBeNull()
    await userEvent.click(row('a')!.querySelector<HTMLElement>('[data-action="edit-schedule"]')!)
    await expect.element(dialog()).toBeVisible()
    external('a', { prompt: 'changed by the agent' })
    await page.getByRole('textbox', { name: 'Title' }).fill('renamed')
    await userEvent.click(page.getByRole('button', { name: 'Save' }))
    await expect.element(page.getByRole('alert').filter({ hasText: 'changed elsewhere' })).toBeVisible()
    expect((page.getByRole('textbox', { name: 'Title' }).element() as HTMLInputElement).value).toBe('renamed')
    expect(updates[0]).toEqual({ id: 'a', patch: { title: 'renamed', revision: 1 } })
    await userEvent.click(page.getByRole('button', { name: 'Save' }))
    await closed()
    expect(updates[1]).toEqual({ id: 'a', patch: { title: 'renamed', revision: 2 } })
    expect(rows.get('a')).toMatchObject({ title: 'renamed', prompt: 'changed by the agent', revision: 3 })
  })
})

describe('暂停、恢复、删除', () => {
  it('暂停与恢复；删除需确认，取消时不删除', async () => {
    const { api, rows } = backend([schedule('a'), schedule('b')])
    await mount(createSchedulesStore(api), <SchedulesTab sessionId="s-1" />)
    await expect.poll(() => row('a')).not.toBeNull()
    await userEvent.click(page.getByRole('button', { name: 'Pause Task a' }))
    await expect.poll(() => row('a')?.dataset.status).toBe('paused')
    expect(rows.get('a')?.status).toBe('paused')
    await userEvent.click(page.getByRole('button', { name: 'Resume Task a' }))
    await expect.poll(() => row('a')?.dataset.status).toBe('active')

    await userEvent.click(page.getByRole('button', { name: 'Delete Task b' }))
    await expect.element(page.getByRole('heading', { name: 'Delete “Task b”?' })).toBeVisible()
    await userEvent.click(dialog().getByRole('button', { name: 'Cancel' }))
    await closed()
    expect(rows.has('b')).toBe(true)
    await userEvent.click(page.getByRole('button', { name: 'Delete Task b' }))
    await userEvent.click(dialog().getByRole('button', { name: 'Delete' }))
    await closed()
    await expect.poll(() => row('b')).toBeNull()
    expect(rows.has('b')).toBe(false)
  })

  it('删除提交中关闭对话框、再打开另一个任务的删除：按钮为初始状态（对话框按任务重新挂载）', async () => {
    const { api } = backend([schedule('a'), schedule('b')])
    let finish!: () => void
    api.remove = () => new Promise<void>((resolve) => (finish = resolve))
    await mount(createSchedulesStore(api), <SchedulesTab sessionId="s-1" />)
    await expect.poll(() => row('b')).not.toBeNull()
    await userEvent.click(page.getByRole('button', { name: 'Delete Task b' }))
    await userEvent.click(dialog().getByRole('button', { name: 'Delete' }))
    await expect.element(dialog().getByRole('button', { name: 'Deleting…' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    await closed()
    await userEvent.click(page.getByRole('button', { name: 'Delete Task a' }))
    await expect.element(page.getByRole('heading', { name: 'Delete “Task a”?' })).toBeVisible()
    await expect.element(dialog().getByRole('button', { name: 'Delete', exact: true })).toBeEnabled()
    await userEvent.click(dialog().getByRole('button', { name: 'Cancel' }))
    await closed()
    finish()
  })

  it('revision 冲突：暂停不生效并读回最新值（另一处的改名可见），再次暂停成功', async () => {
    const { api, external, rows } = backend([schedule('a')])
    await mount(createSchedulesStore(api), <SchedulesTab sessionId="s-1" />)
    await expect.poll(() => row('a')).not.toBeNull()
    external('a', { title: 'Renamed by agent' })
    await userEvent.click(page.getByRole('button', { name: 'Pause Task a' }))
    await expect.poll(() => row('a')?.textContent).toContain('Renamed by agent')
    expect(rows.get('a')?.status).toBe('active')
    await userEvent.click(page.getByRole('button', { name: 'Pause Renamed by agent' }))
    await expect.poll(() => rows.get('a')?.status).toBe('paused')
  })
})

describe('界面验收', () => {
  it.each(['light', 'dark'] as const)('%s 主题：文字与背景不同色，跳过结果用警示文字色且对比度 ≥ 4.5:1', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    const { api } = backend([schedule('a', { lastFire: { status: 'skipped', reason: 'budget' } })])
    const screen = await mount(createSchedulesStore(api), <SchedulesTab sessionId="s-1" />)
    await expect.poll(() => row('a')).not.toBeNull()
    const rgb = (value: string) =>
      value
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number) as [number, number, number]
    const lum = ([r, g, b]: [number, number, number]) => {
      const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    const contrast = (a: string, b: string) => {
      const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p)
      return (x! + 0.05) / (y! + 0.05)
    }
    const bg = getComputedStyle(screen.container.querySelector('.bg-background')!).backgroundColor
    const last = row('a')!.querySelector('[data-slot="schedule-last"]')!
    const title = row('a')!.querySelector('[data-user-content]')!
    expect(contrast(getComputedStyle(last).color, bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(getComputedStyle(title).color, bg)).toBeGreaterThanOrEqual(4.5)
  })

  it('390 px：长标题截断，行操作都在可见范围内，没有横向溢出', async () => {
    await page.viewport(390, 800)
    const { api } = backend([schedule('a', { title: 'A very long scheduled task title that keeps going and going'.repeat(2) })])
    const screen = await mount(createSchedulesStore(api), <SchedulesTab sessionId="s-1" />, { width: 390 })
    await expect.poll(() => row('a')).not.toBeNull()
    const host = screen.container.firstElementChild as HTMLElement
    expect(host.scrollWidth).toBeLessThanOrEqual(390)
    for (const button of row('a')!.querySelectorAll('button')) expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(390)
    const title = row('a')!.querySelector<HTMLElement>('[data-user-content]')!
    expect(title.scrollWidth).toBeGreaterThan(title.clientWidth)
  })
})

describe('时间线的 schedule_fire 行', () => {
  it('开始与跳过（原因、计划时刻、合并的错过次数）；标题来自任务，已删除时注明', async () => {
    const store = createSchedulesStore(backend([schedule('a', { title: 'Nightly build' })]).api)
    await store.getState().load('s-1')
    await mount(
      store,
      <>
        <ScheduleFireRow item={{ kind: 'schedule-fire', key: '1', fire: { scheduleId: 'a', occurrence: NOV2_9_UTC, status: 'started', runId: 'r1' } }} />
        <ScheduleFireRow
          item={{
            kind: 'schedule-fire',
            key: '2',
            fire: { scheduleId: 'gone', occurrence: NOV2_9_UTC, status: 'skipped', reason: 'workspace-missing', missed: 2 },
          }}
        />
      </>,
    )
    const rows = [...document.querySelectorAll<HTMLElement>('[data-slot="schedule-fire"]')]
    expect(rows.map((r) => [r.dataset.status, r.dataset.reason])).toEqual([
      ['started', undefined],
      ['skipped', 'workspace-missing'],
    ])
    expect(rows[0]!.textContent).toContain('Scheduled task started')
    expect(rows[0]!.textContent).toContain('Nightly build')
    expect(rows[1]!.textContent).toContain('Scheduled task skipped')
    expect(rows[1]!.textContent).toContain('Deleted scheduled task')
    expect(rows[1]!.textContent).toContain('the working directory is missing')
    expect(rows[1]!.textContent).toContain('2 missed runs merged')
  })

  it('任务不在列表中时，开始的 Run 显示其输入包装中的标题', async () => {
    const store = createSchedulesStore(backend([]).api)
    await store.getState().load('s-1')
    await mount(
      store,
      <ScheduleFireRow
        item={{ kind: 'schedule-fire', key: '1', title: 'Weekly report', fire: { scheduleId: 'gone', occurrence: NOV2_9_UTC, status: 'started', runId: 'r1' } }}
      />,
    )
    const row = document.querySelector<HTMLElement>('[data-slot="schedule-fire"]')!
    expect(row.textContent).toContain('Weekly report')
    expect(row.textContent).not.toContain('Deleted scheduled task')
  })
})
