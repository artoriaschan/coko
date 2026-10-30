// 设置 → 定时任务（全部会话、打开所在会话并切到 Schedules tab、暂停、删除）与设置 → 通知（总开关与三类开关读写设置键 notifications，
// 冲突读回）：整页 App 中渲染。
import '../../styles.css'
import { NOTIFICATIONS_SETTING, type Schedule } from '@coko/protocol'
import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { createSchedulesStore, type SchedulesBackend } from '../../stores/schedules-store.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'
import { settingsRegion } from '../../testing/settings-page.ts'
import { SchedulesStoreProvider } from '../conversation/schedules-button.tsx'
import { rightPanelTabStore } from '../right-panel/tabs.ts'

const schedule = (id: string, sessionId: string, patch: Partial<Schedule> = {}): Schedule => ({
  id,
  sessionId,
  title: `Task ${id}`,
  prompt: 'p',
  rule: { kind: 'every', seconds: 3600 },
  status: 'active',
  nextAt: Date.now() + 3_600_000,
  revision: 1,
  ...patch,
})

function schedulesBackend(initial: Schedule[]) {
  const rows = new Map(initial.map((s) => [s.id, s]))
  const api: SchedulesBackend = {
    list: async (sessionId) => [...rows.values()].filter((s) => sessionId === undefined || s.sessionId === sessionId),
    create: async () => {
      throw new Error('unused')
    },
    update: async (id, patch) => {
      const { revision: _r, ...rest } = patch
      const updated: Schedule = { ...rows.get(id)!, ...rest, revision: rows.get(id)!.revision + 1 }
      rows.set(id, updated)
      return updated
    },
    remove: async (id) => void rows.delete(id),
  }
  return { api, rows }
}

const notificationsValue = (fixture: ReturnType<typeof createFixtureChat>) =>
  fixture.backend.settings.get(NOTIFICATIONS_SETTING)?.value as { enabled: boolean } | undefined

function renderApp(initial: Schedule[] = [], locale: 'en' | 'zh' = 'en') {
  const appearance = createAppearanceStore({ theme: 'light', locale })
  const fixture = createFixtureChat()
  const settingsPage = createSettingsPageStore()
  const preferences = createPreferences({ appearance, settings: fixture.settings, onConflict: () => {}, onFailure: () => {} })
  const schedules = schedulesBackend(initial)
  const store = createSchedulesStore(schedules.api)
  const screen = render(
    <div style={{ width: '100vw', height: '100vh' }}>
      <SchedulesStoreProvider store={store}>
        <App
          store={appearance}
          connection={createConnectionStore()}
          chat={fixture.chat}
          settings={fixture.settings}
          preferences={preferences}
          settingsPage={settingsPage}
          pickDirectory={async () => null}
        />
      </SchedulesStoreProvider>
    </div>,
  )
  return { screen, settingsPage, fixture, schedules }
}

afterEach(async () => {
  rightPanelTabStore.setState({ selected: null })
  await page.viewport(1280, 800)
})

const item = (id: string) => settingsRegion().element().querySelector<HTMLElement>(`li[data-schedule-id="${id}"]`)

describe('设置 → 定时任务', () => {
  it('列出全部会话的任务（按会话分组，标题为会话标题）；暂停与删除（确认）', async () => {
    const { screen, settingsPage, schedules } = renderApp([schedule('a', 's-1'), schedule('b', 's-3'), schedule('c', 's-1', { status: 'paused' })])
    await screen
    settingsPage.open('schedules')
    await expect.element(settingsRegion().getByRole('heading', { name: 'Scheduled tasks', level: 2 })).toBeVisible()
    await expect.poll(() => item('c')).not.toBeNull()
    const groups = [...settingsRegion().element().querySelectorAll<HTMLElement>('[data-schedule-session]')].map((g) => ({
      session: g.dataset.scheduleSession,
      title: g.querySelector('h3')!.textContent,
      items: [...g.querySelectorAll<HTMLElement>('li')].map((li) => li.dataset.scheduleId),
    }))
    expect(groups).toEqual([
      { session: 's-1', title: '设计 token 与三栏骨架', items: ['a', 'c'] },
      { session: 's-3', title: 'SQLite 迁移与租约', items: ['b'] },
    ])
    await userEvent.click(settingsRegion().getByRole('button', { name: 'Pause Task a' }))
    await expect.poll(() => item('a')?.dataset.status).toBe('paused')
    expect(schedules.rows.get('a')?.status).toBe('paused')
    await userEvent.click(settingsRegion().getByRole('button', { name: 'Delete Task b' }))
    await userEvent.click(page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }))
    await expect.poll(() => document.querySelector('[role="dialog"]')).toBeNull()
    await expect.poll(() => item('b')).toBeNull()
    expect(settingsRegion().element().querySelector('[data-schedule-session="s-3"]')).toBeNull()
  })

  it('打开会话：返回应用、切到该会话，并在右栏打开 Schedules tab', async () => {
    const { screen, settingsPage, fixture } = renderApp([schedule('b', 's-3')])
    await screen
    await expect.poll(() => fixture.chat.getState().activeSessionId).toBe('s-1')
    settingsPage.open('schedules')
    await expect.poll(() => item('b')).not.toBeNull()
    await userEvent.click(settingsRegion().getByRole('button', { name: 'Open the session of Task b' }))
    await expect.poll(() => settingsPage.getSnapshot().visible).toBe(false)
    expect(fixture.chat.getState().activeSessionId).toBe('s-3')
    await expect.poll(() => rightPanelTabStore.getState().selected).toBe('schedules')
    await expect.poll(() => document.querySelector('[role="tab"][data-tab="schedules"]')?.getAttribute('aria-selected')).toBe('true')
    await expect.poll(() => document.querySelector('[data-slot="schedules-tab"] li[data-schedule-id="b"]')).not.toBeNull()
  })

  it('没有任务时为空状态（中文）', async () => {
    const { screen, settingsPage } = renderApp([], 'zh')
    await screen
    settingsPage.open('schedules')
    await expect.element(settingsRegion().getByText('还没有定时任务')).toBeVisible()
  })
})

describe('设置 → 通知', () => {
  const box = (name: string) => settingsRegion().element().querySelector<HTMLElement>(`[data-notification="${name}"] [role="checkbox"]`)!

  it('缺省全开；关闭"定时任务结束"写入设置键 notifications；总开关关闭时三类开关不可改', async () => {
    const { screen, settingsPage, fixture } = renderApp()
    await screen
    settingsPage.open('notifications')
    await expect.element(settingsRegion().getByRole('heading', { name: 'Notifications', level: 2 })).toBeVisible()
    await expect.poll(() => box('enabled').hasAttribute('disabled')).toBe(false)
    expect(['enabled', 'scheduleRunEnded', 'approvalWaiting', 'agentFinished'].map((n) => box(n).dataset.notificationEnabled)).toEqual([
      'true',
      'true',
      'true',
      'true',
    ])

    await userEvent.click(settingsRegion().getByRole('checkbox', { name: 'Scheduled task finished' }))
    await expect
      .poll(() => fixture.backend.settings.get(NOTIFICATIONS_SETTING)?.value)
      .toEqual({
        enabled: true,
        scheduleRunEnded: false,
        approvalWaiting: true,
        agentFinished: true,
      })
    expect(box('scheduleRunEnded').dataset.notificationEnabled).toBe('false')

    await userEvent.click(settingsRegion().getByRole('checkbox', { name: 'Desktop notifications' }))
    await expect.poll(() => notificationsValue(fixture)?.enabled).toBe(false)
    await expect.poll(() => box('approvalWaiting').hasAttribute('disabled')).toBe(true)
    // 键盘：总开关可经 Space 重新打开。
    box('enabled').focus()
    await userEvent.keyboard(' ')
    await expect.poll(() => notificationsValue(fixture)?.enabled).toBe(true)
    await expect.poll(() => box('approvalWaiting').hasAttribute('disabled')).toBe(false)
  })

  it('revision 冲突：读回另一处写入的值，不覆盖它', async () => {
    const { screen, settingsPage, fixture } = renderApp()
    await screen
    settingsPage.open('notifications')
    await expect.poll(() => box('enabled').hasAttribute('disabled')).toBe(false)
    fixture.backend.externalWrite(NOTIFICATIONS_SETTING, { enabled: true, scheduleRunEnded: true, approvalWaiting: false, agentFinished: true })
    await userEvent.click(settingsRegion().getByRole('checkbox', { name: 'Background subagent finished' }))
    await expect.poll(() => box('approvalWaiting').dataset.notificationEnabled).toBe('false')
    expect(box('agentFinished').dataset.notificationEnabled).toBe('true')
    expect(fixture.backend.settings.get(NOTIFICATIONS_SETTING)?.value).toEqual({
      enabled: true,
      scheduleRunEnded: true,
      approvalWaiting: false,
      agentFinished: true,
    })
  })

  it('不合 schema 的已存值按缺省显示（与 Sidecar 一致）', async () => {
    const { screen, settingsPage, fixture } = renderApp()
    fixture.backend.externalWrite(NOTIFICATIONS_SETTING, { enabled: 'yes' })
    await fixture.settings.getState().load()
    await screen
    settingsPage.open('notifications')
    await expect.poll(() => box('enabled').hasAttribute('disabled')).toBe(false)
    expect(box('enabled').dataset.notificationEnabled).toBe('true')
  })
})
