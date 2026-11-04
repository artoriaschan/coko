// 消息时间标签：同一本地日只显示 HH:mm，更早的同年日期带月日，往年带年月日；日界参照可注入。
import { createTranslator } from '@coko/i18n'
import { describe, expect, it } from 'vitest'
import { formatMessageClock, msUntilNextLocalMidnight, startOfLocalDay } from './message-clock.ts'

const zh = createTranslator('zh')
const en = createTranslator('en')

describe('formatMessageClock', () => {
  const now = new Date(2026, 6, 29, 10, 0).getTime()

  it('keeps HH:mm on the same local day', () => {
    expect(formatMessageClock(new Date(2026, 6, 29, 14, 24).getTime(), zh, now)).toBe('14:24')
    expect(formatMessageClock(new Date(2026, 6, 29, 9, 5).getTime(), en, now)).toBe('09:05')
  })

  it('prefixes month and day across days in the same year', () => {
    expect(formatMessageClock(new Date(2026, 0, 1, 14, 24).getTime(), zh, now)).toBe('1月1日 14:24')
    expect(formatMessageClock(new Date(2026, 0, 1, 14, 24).getTime(), en, now)).toBe('1/1 14:24')
  })

  it('prefixes year, month, and day across years', () => {
    expect(formatMessageClock(new Date(2025, 11, 31, 9, 5).getTime(), zh, now)).toBe('2025年12月31日 09:05')
    expect(formatMessageClock(new Date(2025, 11, 31, 9, 5).getTime(), en, now)).toBe('2025-12-31 09:05')
  })
})

describe('local midnight arithmetic', () => {
  it('starts the local day at midnight and waits until the next one', () => {
    const noon = new Date(2026, 6, 29, 12, 0).getTime()
    expect(startOfLocalDay(noon)).toBe(new Date(2026, 6, 29).getTime())
    expect(msUntilNextLocalMidnight(noon)).toBe(12 * 3_600_000)
    expect(msUntilNextLocalMidnight(new Date(2026, 6, 29, 23, 59, 59, 999).getTime())).toBe(1)
  })
})
