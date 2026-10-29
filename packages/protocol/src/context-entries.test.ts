import { Value } from 'typebox/value'
import { describe, expect, it } from 'vitest'
import { SessionEntry } from './entries.ts'
import { fileReferencePath, formatFileReferenceOpen, formatNestedInstructionOpen, nestedInstructionPath } from './files.ts'
import { RunStartPayload } from './runs.ts'
import { ProgressEvent } from './ws.ts'

const base = { sessionId: 's1', seq: 1, payloadVersion: 1, runId: 'r1', createdAt: 1 }
const compaction = { summary: 's', firstKeptSeq: 3, tokensBefore: 100, trigger: 'auto', readFiles: ['a.ts'], modifiedFiles: [] }

describe('M3 预先声明的条目与事件', () => {
  it('command 与 compaction 按各自 schema 校验', () => {
    const check = (kind: string, payload: unknown) => Value.Check(SessionEntry, { ...base, kind, payload })
    expect(check('command', { name: 'review', args: '1 2', source: 'project' })).toBe(true)
    expect(check('command', { name: 'review', args: '', source: 'plugin' })).toBe(false)
    expect(check('command', { name: '', args: '', source: 'user' })).toBe(false)
    expect(check('compaction', compaction)).toBe(true)
    expect(check('compaction', { ...compaction, tokensAfter: 10, trigger: 'overflow', invokedSkills: ['x'] })).toBe(true)
    expect(check('compaction', { ...compaction, trigger: 'later' })).toBe(false)
    expect(check('compaction', { ...compaction, firstKeptSeq: 0 })).toBe(false)
    expect(check('compaction', { summary: 's', firstKeptSeq: 1 })).toBe(false)
  })

  it('RunTrigger 含 compact', () => {
    expect(Value.Check(RunStartPayload, { trigger: 'compact' })).toBe(true)
  })

  it('progress：context_usage 与三个压缩事件', () => {
    expect(Value.Check(ProgressEvent, { type: 'context_usage', tokens: 1200, contextWindow: 128_000 })).toBe(true)
    expect(Value.Check(ProgressEvent, { type: 'compaction_start', trigger: 'manual' })).toBe(true)
    expect(Value.Check(ProgressEvent, { type: 'compaction_end', trigger: 'auto', tokensBefore: 9, tokensAfter: 3 })).toBe(true)
    expect(Value.Check(ProgressEvent, { type: 'compaction_failed', trigger: 'auto', message: 'x', consecutiveFailures: 2 })).toBe(true)
    expect(Value.Check(ProgressEvent, { type: 'compaction_failed', trigger: 'auto', message: 'x' })).toBe(false)
    expect(Value.Check(ProgressEvent, { type: 'context_usage', tokens: -1, contextWindow: 1 })).toBe(false)
  })
})

describe('File Reference 与嵌套指令的文本块', () => {
  it('开标签与识别互逆（path 按属性转义）', () => {
    const path = 'src/a "b" & <c>.ts'
    expect(fileReferencePath(formatFileReferenceOpen(path) + '\n...')).toBe(path)
    expect(nestedInstructionPath(formatNestedInstructionOpen(path) + '\n...')).toBe(path)
  })

  it('不以开标签开头的文本不识别', () => {
    expect(fileReferencePath('see <file_reference path="a">')).toBeUndefined()
    expect(nestedInstructionPath('<instruction_file path="a">')).toBeUndefined()
    expect(fileReferencePath(formatNestedInstructionOpen('a'))).toBeUndefined()
  })
})
