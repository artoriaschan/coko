// 定时任务界面（docs/subsystems/schedules.md#界面）：真实 Electron + 真实 Sidecar（faux、测试时钟 COKO_TEST_CLOCK=1）。在会话中新建 cron 任务 →
// 列表显示下次时间与时区 → 拨快测试时钟后时间线出现 Run 与 schedule_fire 行、投递历史增加一条；暂停后拨快不投递。设置 → 定时任务列出
// 全部会话的任务并可跳转；设置 → 通知关闭"定时任务结束"后拨快时钟，日志中没有该会话的 notification shown（开启时有）。
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { launchApp, notificationsShown, stubDirectoryPicker, waitConnected, type LaunchedApp } from './harness.ts'

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

/** 测试时钟的起点：2026-11-02 08:30 UTC；每天 09:00 UTC 的 cron 在 30 分钟后到期。 */
const CLOCK_START = Date.parse('2026-11-02T08:30:00Z')
const MINUTE = 60_000

async function setup(script: unknown) {
  const root = await mkdtemp(join(tmpdir(), 'coko-schedules-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  await writeFile(join(root, 'faux.json'), JSON.stringify(script))
  const app = await launchApp({ COKO_FAUX_SCRIPT: join(root, 'faux.json'), COKO_TEST_CLOCK: '1', COKO_TEST_CLOCK_START: String(CLOCK_START) }, { dir: root })
  apps.push(app)
  await waitConnected(app.window)
  await stubDirectoryPicker(app.app, [workspace])
  await app.window
    .getByRole('button', { name: /^(Add workspace|添加工作区)$/ })
    .first()
    .click()
  await app.window.getByRole('heading', { level: 1, name: /^(New session|新会话)$/ }).waitFor()
  return { app, root }
}

const composer = (app: LaunchedApp) => app.window.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
async function send(app: LaunchedApp, text: string) {
  await composer(app).click()
  await composer(app).fill(text)
  await composer(app).press('Enter')
}
const lastReply = (app: LaunchedApp) => app.window.getByRole('article', { name: 'Coko' }).last().textContent()

/** 经 renderer 的同源代理调用 Sidecar（附加认证）。 */
async function api<T>(window: Page, method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  return window.evaluate(
    async ({ method, path, body }) => {
      const response = await fetch(path, {
        method,
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      })
      return { status: response.status, body: response.status === 204 ? null : await response.json() }
    },
    { method, path, body },
  ) as Promise<{ status: number; body: T }>
}

async function advanceClock(window: Page, ms: number) {
  const response = await api<{ now: number }>(window, 'POST', '/api/test/clock', { advanceMs: ms })
  expect(response.status).toBe(200)
}

/**
 * 关闭应用后读取 notification shown：main 的文件日志按块缓冲（单条记录要到 8 KB、相隔 5 秒的下一条记录或退出时才写入），
 * 运行中轮询读不到；有序退出时 logging 的 dispose 写出缓冲。
 */
async function notificationsAfterQuit(app: LaunchedApp) {
  await apps.splice(apps.indexOf(app), 1)[0]!.dispose()
  return (await notificationsShown(app.dir)).filter((n) => n.kind === 'schedule-run-ended').map((n) => n.sessionId)
}

/** Session 的 run_end 条目数（Sidecar 中的 Run 结束，含定时任务的 Run）。 */
const runEnds = async (window: Page, sessionId: string) =>
  (await api<{ entries: { kind: string }[] }>(window, 'GET', `/api/sessions/${sessionId}`)).body.entries.filter((e) => e.kind === 'run_end').length

const sessionIdByTitle = async (window: Page, title: string) =>
  (await api<{ sessions: { id: string; title: string }[] }>(window, 'GET', '/api/sessions')).body.sessions.find((s) => s.title === title)!.id

describe('定时任务界面', { timeout: 180_000 }, () => {
  it('新建 cron 任务 → 下次时间 → 拨快时钟后 Run、schedule_fire 行与投递历史；暂停后拨快不投递', async () => {
    const { app } = await setup({
      responses: [
        { content: 'Ready.', match: 'hello' },
        { content: 'Scheduled check done.', match: 'scheduled_task' },
        { content: 'All quiet.', match: 'status?' },
      ],
    })
    const { window } = app
    await send(app, 'hello')
    await expect.poll(() => lastReply(app), { timeout: 30_000 }).toBe('Ready.')

    // 标题栏按钮打开右栏的 Schedules tab；键盘与指针都可以完成新建。
    await window.locator('[data-action="open-schedules"]').click()
    await expect.poll(() => window.locator('[role="tab"][data-tab="schedules"]').getAttribute('aria-selected')).toBe('true')
    await window.locator('[data-action="new-schedule"]').click()
    const form = window.locator('[data-slot="schedule-form-dialog"]')
    await form.waitFor()
    // 时区下拉缺省为本机时区（应用进程的 Intl 时区）。
    const localZone = await window.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
    expect(await form.locator('[data-slot="time-zone-picker"]').getAttribute('data-value')).toBe(localZone)
    await form.locator('input[name="schedule-title"]').fill('Morning check')
    await form.locator('textarea[name="schedule-prompt"]').fill('Check the build status')
    await form.locator('input[name="schedule-cron"]').fill('0 9 * * *')
    await form.locator('[data-slot="time-zone-picker"]').click()
    await window.locator('[role="menuitemradio"][data-zone="UTC"]').click()
    await expect.poll(() => form.locator('[data-slot="time-zone-picker"]').getAttribute('data-value')).toBe('UTC')
    await expect.poll(() => form.locator('[data-slot="schedule-upcoming"] li').count()).toBe(3)
    await form.locator('[data-action="save-schedule"]').click()
    await form.waitFor({ state: 'detached' })

    // 列表：下次时间为测试时钟之后的 09:00 UTC，注明时区；徽标为 active 数。
    const item = window.locator('[data-slot="schedules-tab"] li[data-schedule-id]')
    await expect.poll(() => item.count()).toBe(1)
    await expect
      .poll(() => item.locator('[data-slot="schedule-next"]').textContent())
      .toMatch(/^(Next Nov 2, 2026, 9:00 AM \(UTC\)|下次 2026年11月2日 09:00（UTC）)$/)
    expect(await item.locator('[data-slot="schedule-rule"]').textContent()).toMatch(/0 9 \* \* \*/)
    expect(await window.locator('[data-slot="schedules-badge"]').textContent()).toBe('1')
    const sessionId = await sessionIdByTitle(window, 'hello')

    // 到期：Run 开始并回复，时间线出现 schedule_fire 行，投递历史增加一条，最近结果为已开始。
    await advanceClock(window, 30 * MINUTE + 1000)
    await expect.poll(() => lastReply(app), { timeout: 30_000 }).toBe('Scheduled check done.')
    const fireRows = window.locator('[data-slot="schedule-fire"]')
    await expect.poll(() => fireRows.count()).toBe(1)
    expect(await fireRows.first().getAttribute('data-status')).toBe('started')
    expect(await fireRows.first().textContent()).toContain('Morning check')
    await expect.poll(() => window.locator('[data-slot="schedule-history-item"]').count()).toBe(1)
    await expect.poll(() => item.locator('[data-slot="schedule-last"]').getAttribute('data-last-status')).toBe('started')
    await expect.poll(() => item.locator('[data-slot="schedule-next"]').textContent()).toMatch(/Nov 3, 2026|2026年11月3日/)

    // 暂停（键盘）：列表与接口都为 paused，没有下次时间；拨快一天也不投递。
    await item.locator('[data-action="pause-schedule"]').focus()
    await window.keyboard.press('Enter')
    await expect.poll(() => item.getAttribute('data-status')).toBe('paused')
    await expect.poll(() => window.locator('[data-slot="schedules-badge"]').count()).toBe(0)
    await advanceClock(window, 24 * 60 * MINUTE + 1000)
    // 同步点：之后的一轮用户消息结束时，定时器早已处理过拨快；时间线仍只有一条 schedule_fire。
    await send(app, 'status?')
    await expect.poll(() => lastReply(app), { timeout: 30_000 }).toBe('All quiet.')
    // 暂停的任务保留 nextAt（恢复时沿用），最近一次发生次仍是第一次的 09:00 UTC。
    const listed = await api<{ id: string; status: string; lastOccurrence?: number }[]>(window, 'GET', `/api/schedules?sessionId=${sessionId}`)
    expect(listed.body.map((s) => [s.status, s.lastOccurrence])).toEqual([['paused', Date.parse('2026-11-02T09:00:00Z')]])
    expect(await item.locator('[data-slot="schedule-next"]').textContent()).toMatch(/^(No next run|没有下次执行)$/)
    expect(await fireRows.count()).toBe(1)
    expect(await window.locator('[data-slot="schedule-history-item"]').count()).toBe(1)
    // 窗口在后台：定时任务的那一次 Run 结束时发出通知（测试构建只记日志），暂停后没有第二次。
    expect(await notificationsAfterQuit(app)).toEqual([sessionId])
  })

  it('设置 → 定时任务列出全部会话并可跳转；设置 → 通知关闭"定时任务结束"时不通知，开启时通知', async () => {
    const { app } = await setup({
      responses: [
        { content: 'First ready.', match: 'first session' },
        { content: 'Second ready.', match: 'second session' },
        { content: 'Muted run done.', match: 'title="Muted"' },
        { content: 'Loud run done.', match: 'title="Loud"' },
      ],
    })
    const { window } = app
    await send(app, 'first session')
    await expect.poll(() => lastReply(app), { timeout: 30_000 }).toBe('First ready.')
    await window
      .getByRole('button', { name: /^(New session|新会话)$/ })
      .first()
      .click()
    await send(app, 'second session')
    await expect.poll(() => lastReply(app), { timeout: 30_000 }).toBe('Second ready.')
    const first = await sessionIdByTitle(window, 'first session')
    const second = await sessionIdByTitle(window, 'second session')
    // 两个任务：Muted（30 分钟后，first 会话）与 Loud（60 分钟后，second 会话）。
    const created = await Promise.all([
      api(window, 'POST', `/api/sessions/${first}/schedules`, { title: 'Muted', prompt: 'muted run', rule: { kind: 'after', seconds: 30 * 60 } }),
      api(window, 'POST', `/api/sessions/${second}/schedules`, { title: 'Loud', prompt: 'loud run', rule: { kind: 'after', seconds: 60 * 60 } }),
    ])
    expect(created.map((r) => r.status)).toEqual([201, 201])

    // 设置 → 定时任务：两个会话各一组；跳转到 first 会话并打开其 Schedules tab。
    await window.getByRole('button', { name: /^(Settings|设置)$/ }).click()
    const settings = window.locator('[data-settings-page]')
    await settings.locator('[data-section="schedules"]').click()
    await expect.poll(() => settings.locator('[data-schedule-session]').count(), { timeout: 15_000 }).toBe(2)
    expect(await settings.locator(`[data-schedule-session="${first}"] li`).textContent()).toContain('Muted')
    expect(await settings.locator(`[data-schedule-session="${second}"] li`).textContent()).toContain('Loud')
    await settings.locator(`[data-schedule-session="${first}"] [data-action="open-schedule-session"]`).click()
    await settings.waitFor({ state: 'detached' })
    await expect.poll(() => window.locator('[data-session-id][aria-current="page"]').getAttribute('data-session-id')).toBe(first)
    await expect.poll(() => window.locator('[role="tab"][data-tab="schedules"]').getAttribute('aria-selected')).toBe('true')
    await expect.poll(() => window.locator('[data-slot="schedules-tab"] li[data-schedule-id]').textContent()).toContain('Muted')

    // 设置 → 通知：关闭"定时任务结束"。
    await window.getByRole('button', { name: /^(Settings|设置)$/ }).click()
    await settings.locator('[data-section="notifications"]').click()
    const toggle = (name: string) => settings.locator(`[data-notification="${name}"] [role="checkbox"]`)
    await expect.poll(() => toggle('scheduleRunEnded').getAttribute('data-notification-enabled')).toBe('true')
    await toggle('scheduleRunEnded').click()
    await expect.poll(() => toggle('scheduleRunEnded').getAttribute('data-notification-enabled')).toBe('false')
    await expect
      .poll(
        async () =>
          (await api<{ settings: { key: string; value: unknown }[] }>(window, 'GET', '/api/settings')).body.settings.find((s) => s.key === 'notifications')
            ?.value,
      )
      .toMatchObject({ enabled: true, scheduleRunEnded: false })

    // Muted 到期：Run 结束，但没有通知。
    await advanceClock(window, 30 * MINUTE + 1000)
    await expect
      .poll(
        async () => (await api<{ id: string; lastFire?: { status: string } }[]>(window, 'GET', `/api/schedules?sessionId=${first}`)).body[0]?.lastFire?.status,
        { timeout: 30_000 },
      )
      .toBe('started')
    await expect.poll(() => runEnds(window, first), { timeout: 30_000 }).toBe(2)

    // 重新开启后 Loud 到期：只有 second 会话有通知，关闭期间结束的 Muted 没有。
    await toggle('scheduleRunEnded').click()
    await expect.poll(() => toggle('scheduleRunEnded').getAttribute('data-notification-enabled')).toBe('true')
    await advanceClock(window, 30 * MINUTE + 1000)
    await expect.poll(() => runEnds(window, second), { timeout: 30_000 }).toBe(2)
    expect(await notificationsAfterQuit(app)).toEqual([second])
  })
})
