import { describe, expect, it } from 'vitest'
import { sessionDateDirectory, sessionDirectoryName } from './session-directory.ts'

describe('独立会话目录名', () => {
  it('默认截取前 12 位，冲突时回退完整 id；相同输入稳定', () => {
    const id = '12345678-1234-5678-9abc-123456789abc'
    expect(sessionDirectoryName(id)).toBe('chat-12345678-123')
    expect(sessionDirectoryName(id)).toBe('chat-12345678-123')
    expect(sessionDirectoryName(id, true)).toBe('12345678-1234-5678-9abc-123456789abc')
  })
  it('日期目录使用本地年月日，补齐个位月份与日期', () => {
    expect(sessionDateDirectory(new Date(2026, 0, 9, 23, 59))).toBe('2026-01-09')
    expect(sessionDateDirectory(new Date(2026, 10, 5, 0, 1))).toBe('2026-11-05')
  })
})
