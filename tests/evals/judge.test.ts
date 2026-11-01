// 评测判定（docs/subsystems/tracing.md#评测）：按 Run 结束后的文件结果判定，原因写进报告。
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { judge } from './judge.ts'

async function workspace(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), 'coko-eval-judge-'))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(dir, path, '..'), { recursive: true })
    await writeFile(join(dir, path), content)
  }
  return dir
}

describe('judge', () => {
  it('全部满足：没有原因', async () => {
    const dir = await workspace({ 'a.txt': 'hello world', 'b.txt': 'kept' })
    const reasons = await judge(
      { files: { 'a.txt': '/^hello/', 'b.txt': 'kept' }, unchanged: ['b.txt'], maxToolCalls: 2, status: 'completed' },
      { dir, initial: { 'b.txt': 'kept' }, status: 'completed', toolCalls: 2 },
    )
    expect(reasons).toEqual([])
  })

  it.each([
    ['内容不同', { files: { 'a.txt': 'bye' } }, ['files/a.txt: expected "bye", got "hello world"']],
    ['正则不匹配', { files: { 'a.txt': '/^bye$/' } }, ['files/a.txt: expected to match /^bye$/, got "hello world"']],
    ['文件不存在', { files: { 'missing.txt': 'x' } }, ['files/missing.txt: file does not exist']],
    ['应不变的文件被改动', { unchanged: ['b.txt'] }, ['unchanged/b.txt: content changed']],
    ['应不变的文件被删除', { unchanged: ['gone.txt'] }, ['unchanged/gone.txt: file was deleted']],
    ['工具调用超出上限', { maxToolCalls: 1 }, ['maxToolCalls: 3 tool calls > 1']],
    ['Run 状态不符', { status: 'aborted' }, ['status: expected aborted, got completed']],
  ])('%s：给出原因', async (_name, expect_, reasons) => {
    const dir = await workspace({ 'a.txt': 'hello world', 'b.txt': 'edited' })
    expect(await judge(expect_, { dir, initial: { 'b.txt': 'kept', 'gone.txt': 'x' }, status: 'completed', toolCalls: 3 })).toEqual(reasons)
  })

  it('缺省期望 status completed', async () => {
    const dir = await workspace({})
    expect(await judge({}, { dir, initial: {}, status: 'error', toolCalls: 0 })).toEqual(['status: expected completed, got error'])
  })
})
