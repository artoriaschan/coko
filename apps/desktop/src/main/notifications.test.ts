import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import type { SidecarNotify } from '@coko/protocol'
import { DESKTOP_LOG_FILE, startDesktopLogging } from './logging.ts'
import { handleNotify, liveNotifications, NOTIFICATION_SHOWN, type NotificationHost, type ShownNotification } from './notifications.ts'

const message: SidecarNotify = { type: 'notify', kind: 'schedule-run-ended', sessionId: 's1', title: 'Nightly check', body: 'Scheduled task run finished' }

function fakeHost(options: { focused: boolean; testBuild?: boolean; supported?: boolean }) {
  const shown: { title: string; body: string }[] = []
  const opened: string[] = []
  const clicks: (() => void)[] = []
  const closes: (() => void)[] = []
  const host: NotificationHost = {
    focused: () => options.focused,
    testBuild: options.testBuild ?? false,
    show(notification) {
      if (options.supported === false) return undefined
      shown.push(notification)
      const handle: ShownNotification = { onClick: (listener) => void clicks.push(listener), onClose: (listener) => void closes.push(listener) }
      return handle
    },
    openSession: (sessionId) => void opened.push(sessionId),
  }
  return { host, shown, opened, click: () => clicks.forEach((c) => c()), close: () => closes.forEach((c) => c()) }
}

async function logged(task: () => void): Promise<{ message: string; properties: Record<string, unknown> }[]> {
  const dir = await mkdtemp(join(tmpdir(), 'coko-notify-log-'))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  const logPath = join(dir, DESKTOP_LOG_FILE)
  const logging = await startDesktopLogging({ logPath, appVersion: '0.0.0-test', console: false })
  try {
    task()
  } finally {
    await logging.dispose()
  }
  return (await readFile(logPath, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { message: string; properties: Record<string, unknown> })
}

describe('桌面通知（main）', () => {
  it('窗口在前台时不显示、不记 notification shown', async () => {
    const fake = fakeHost({ focused: true })
    let result: boolean | undefined
    const records = await logged(() => (result = handleNotify(message, fake.host)))
    expect([result, fake.shown]).toEqual([false, []])
    expect(records.filter((r) => r.message === NOTIFICATION_SHOWN)).toEqual([])
  })

  it('不在前台时显示标题与正文；点击调用 openSession（该会话），之后不再持有引用', async () => {
    const fake = fakeHost({ focused: false })
    const before = liveNotifications()
    let result: boolean | undefined
    const records = await logged(() => (result = handleNotify(message, fake.host)))
    expect([result, fake.shown]).toEqual([true, [{ title: 'Nightly check', body: 'Scheduled task run finished' }]])
    expect(liveNotifications()).toBe(before + 1)
    expect(fake.opened).toEqual([])
    fake.click()
    expect(fake.opened).toEqual(['s1'])
    expect(liveNotifications()).toBe(before)
    expect(records.filter((r) => r.message === NOTIFICATION_SHOWN).map((r) => r.properties)).toEqual([
      expect.objectContaining({ kind: 'schedule-run-ended', sessionId: 's1' }),
    ])
  })

  it('关闭后不再持有引用；系统不支持时不记 notification shown', async () => {
    const fake = fakeHost({ focused: false })
    const before = liveNotifications()
    handleNotify(message, fake.host)
    fake.close()
    expect(liveNotifications()).toBe(before)
    const unsupported = fakeHost({ focused: false, supported: false })
    const records = await logged(() => expect(handleNotify(message, unsupported.host)).toBe(false))
    expect(records.filter((r) => r.message === NOTIFICATION_SHOWN)).toEqual([])
  })

  it('测试构建不显示，只记 notification shown（带类别与会话）', async () => {
    const fake = fakeHost({ focused: false, testBuild: true })
    const records = await logged(() => expect(handleNotify(message, fake.host)).toBe(true))
    expect(fake.shown).toEqual([])
    expect(records.filter((r) => r.message === NOTIFICATION_SHOWN).map((r) => r.properties)).toEqual([
      expect.objectContaining({ kind: 'schedule-run-ended', sessionId: 's1', title: 'Nightly check' }),
    ])
  })
})
