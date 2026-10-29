import { describe, expect, it } from 'vitest'
import { parseCommandArgs, parseCommandInvocation, substituteArgs } from './index.ts'

describe('parseCommandArgs', () => {
  it.each([
    ['空白分隔', 'a  b\tc', ['a', 'b', 'c']],
    ['双引号与单引号内保留空白', 'one "two words" \'three  four\'', ['one', 'two words', 'three  four']],
    ['空引号是一个空参数', 'a "" b', ['a', '', 'b']],
    ['引号紧接文字拼成一个参数', 'pre"fix x"', ['prefix x']],
    ['空串', '', []],
  ])('%s', (_name, input, expected) => {
    expect(parseCommandArgs(input)).toEqual(expected)
  })
})

describe('substituteArgs', () => {
  it.each([
    ['$1 与 $2', 'Review $1 then $2', ['src', 'docs'], 'Review src then docs'],
    ['缺少的位置参数为空', 'A=$1 B=$2', ['x'], 'A=x B='],
    ['$@ 与 $ARGUMENTS 为全部参数', 'all: $@ | $ARGUMENTS', ['a', 'b c'], 'all: a b c | a b c'],
    ['${N:-default}：缺失或空时取默认', 'x=${1:-one} y=${2:-two}', ['', 'given'], 'x=one y=given'],
    ['${@:-default}：没有参数时取默认', 'files: ${@:-everything}', [], 'files: everything'],
    ['${@:N}：从第 N 个起', 'rest: ${@:2}', ['a', 'b', 'c'], 'rest: b c'],
    ['${@:N:L}：从第 N 个起 L 个', 'mid: ${@:2:1}', ['a', 'b', 'c'], 'mid: b'],
    ['${@:0} 按 1 处理', '${@:0}', ['a', 'b'], 'a b'],
    ['引号参数作为一个位置参数', 'path=$1', ['my file.ts'], 'path=my file.ts'],
    ['不递归：参数中的占位符原样保留', 'say $1', ['$2 and $ARGUMENTS'], 'say $2 and $ARGUMENTS'],
    ['默认值中的占位符原样保留', '${1:-$2}', [], '$2'],
  ])('%s', (_name, template, args, expected) => {
    expect(substituteArgs(template, args)).toBe(expected)
  })

  it('模板没有占位符且有参数时追加 ARGUMENTS 行（原始参数文本）', () => {
    expect(substituteArgs('Summarize the diff.', ['a', 'b c'], 'a "b c"')).toBe('Summarize the diff.\n\nARGUMENTS: a "b c"')
    // 未给出原始文本时按空格拼接。
    expect(substituteArgs('Summarize.', ['a', 'b'])).toBe('Summarize.\n\nARGUMENTS: a b')
  })

  it('没有参数时不追加；有占位符时不追加', () => {
    expect(substituteArgs('Summarize the diff.', [], '')).toBe('Summarize the diff.')
    expect(substituteArgs('Use $1', ['x', 'y'], 'x y')).toBe('Use x')
    // 占位符展开为空同样算作有占位符。
    expect(substituteArgs('Use ${3:-}', ['x'], 'x')).toBe('Use ')
  })
})

describe('parseCommandInvocation', () => {
  it.each([
    ['名字与参数', '/review src', { name: 'review', args: 'src' }],
    ['命名空间', '/git:commit  -m "fix it"', { name: 'git:commit', args: '-m "fix it"' }],
    ['只有名字', '/compact', { name: 'compact', args: '' }],
    ['多行参数保留换行', '/plan first\nsecond', { name: 'plan', args: 'first\nsecond' }],
    ['名字后直接换行', '/plan\nbody', { name: 'plan', args: 'body' }],
  ])('%s', (_name, text, expected) => {
    expect(parseCommandInvocation(text)).toEqual(expected)
  })

  it.each([
    ['不以 / 开头', 'please /review'],
    ['开头有空白', ' /review'],
    ['路径不是命令', '/usr/bin/env node'],
    ['只有 /', '/'],
    ['名字含非法字符', '/re*view x'],
  ])('%s → undefined', (_name, text) => {
    expect(parseCommandInvocation(text)).toBeUndefined()
  })
})
