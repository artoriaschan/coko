import { describe, expect, it } from 'vitest'
import { withoutSqliteExperimentalWarning } from './warnings.ts'

describe('withoutSqliteExperimentalWarning', () => {
  const capture = () => {
    const seen: unknown[][] = []
    const emit = withoutSqliteExperimentalWarning((...args: unknown[]) => void seen.push(args))
    return { seen, emit }
  }

  it('丢弃 node:sqlite 的 ExperimentalWarning（字符串类型与 options 两种调用）', () => {
    const { seen, emit } = capture()
    emit('SQLite is an experimental feature and might change at any time', 'ExperimentalWarning')
    emit('SQLite is an experimental feature and might change at any time', { type: 'ExperimentalWarning' })
    expect(seen).toEqual([])
  })

  it('其他警告原样传递：其他实验特性、SQLite 的非实验警告、Error 形式', () => {
    const { seen, emit } = capture()
    const error = new Error('something else')
    emit('Fetch is an experimental feature', 'ExperimentalWarning')
    emit('SQLite database is locked', 'Warning')
    emit(error)
    expect(seen).toEqual([['Fetch is an experimental feature', 'ExperimentalWarning'], ['SQLite database is locked', 'Warning'], [error]])
  })
})
