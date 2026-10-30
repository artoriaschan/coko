import { describe, expect, it } from 'vitest'
import type { TodoItem } from '../../session-entries/index.ts'
import { createTodoTool, normalizeTodoItems, TODO_SECTION_NAME, todoListSection, todoResultText, TodoValidationError, type TodoInputItem } from './index.ts'

const pending = (content: string, extra: Partial<TodoInputItem> = {}): TodoInputItem => ({ content, status: 'pending', ...extra })

describe('normalizeTodoItems：id 生成', () => {
  it('省略的 id 按位置生成 t1…；给出的 id 原样保留；content 与 result 去掉首尾空白，空 blockedBy 省略', () => {
    expect(
      normalizeTodoItems([
        pending('  read the spec  '),
        { id: 'tests', content: 'write tests', status: 'in_progress', blockedBy: [] },
        { content: 'ship', status: 'completed', result: '  done  ' },
      ]),
    ).toEqual([
      { id: 't1', content: 'read the spec', status: 'pending' },
      { id: 'tests', content: 'write tests', status: 'in_progress' },
      { id: 't3', content: 'ship', status: 'completed', result: 'done' },
    ])
  })

  it('空表合法（清空列表）', () => {
    expect(normalizeTodoItems([])).toEqual([])
  })
})

describe('normalizeTodoItems：每条校验违反时抛出参数错误', () => {
  const cases: [string, TodoInputItem[], RegExp][] = [
    ['content 重复', [pending('a'), pending('a')], /duplicate content/i],
    ['content 去掉空白后重复', [pending('a'), pending(' a ')], /duplicate content/i],
    ['id 重复', [pending('a', { id: 'x' }), pending('b', { id: 'x' })], /duplicate id/i],
    ['给出的 id 与生成的 id 相同', [pending('a'), pending('b', { id: 't1' })], /duplicate id/i],
    ['content 为空', [pending('   ')], /content.*empty/i],
    ['content 超过 500 字符', [pending('x'.repeat(501))], /500/],
    ['超过 50 项', Array.from({ length: 51 }, (_, i) => pending('item ' + i)), /50/],
    ['两个 in_progress', [pending('a', { status: 'in_progress' }), pending('b', { status: 'in_progress' })], /in_progress/],
    ['blockedBy 引用表外 id', [pending('a', { blockedBy: ['t9'] })], /unknown.*t9/i],
    ['blockedBy 引用自己', [pending('a', { blockedBy: ['t1'] })], /cycle/i],
    ['blockedBy 成环', [pending('a', { blockedBy: ['t3'] }), pending('b', { blockedBy: ['t1'] }), pending('c', { blockedBy: ['t2'] })], /cycle/i],
    ['前置未完成时 in_progress', [pending('a'), pending('b', { status: 'in_progress', blockedBy: ['t1'] })], /t1.*not finished/i],
    ['前置未完成时 completed', [pending('a', { status: 'in_progress' }), pending('b', { status: 'completed', blockedBy: ['t1'] })], /t1.*not finished/i],
    ['result 在 pending 项上', [pending('a', { result: 'x' })], /result/i],
    ['result 在 in_progress 项上', [pending('a', { status: 'in_progress', result: 'x' })], /result/i],
    ['result 超过 1000 字符', [pending('a', { status: 'completed', result: 'r'.repeat(1001) })], /1000/],
  ]
  it.each(cases)('%s', (_name, items, message) => {
    expect(() => normalizeTodoItems(items)).toThrow(TodoValidationError)
    expect(() => normalizeTodoItems(items)).toThrow(message)
  })

  it('边界值合法：500 字符、50 项、1000 字符的 result；前置项 completed / cancelled 时可以 in_progress 或 completed', () => {
    expect(normalizeTodoItems([pending('x'.repeat(500))])).toHaveLength(1)
    expect(normalizeTodoItems(Array.from({ length: 50 }, (_, i) => pending('item ' + i)))).toHaveLength(50)
    expect(normalizeTodoItems([pending('a', { status: 'cancelled', result: 'r'.repeat(1000) })])[0]!.result).toHaveLength(1000)
    expect(
      normalizeTodoItems([
        pending('a', { status: 'completed' }),
        pending('b', { status: 'cancelled' }),
        pending('c', { status: 'in_progress', blockedBy: ['t1', 't2'] }),
        pending('d', { status: 'completed', blockedBy: ['t1'] }),
        pending('e', { blockedBy: ['t3'] }),
      ]).map((i) => i.status),
    ).toEqual(['completed', 'cancelled', 'in_progress', 'completed', 'pending'])
  })
})

describe('结果文本与 <todo_list>', () => {
  const items: TodoItem[] = [
    { id: 't1', content: 'read the spec', status: 'completed', result: 'spec has 3 parts' },
    { id: 't2', content: 'write tests', status: 'in_progress' },
    { id: 't3', content: 'implement', status: 'pending', blockedBy: ['t2'] },
    { id: 't4', content: 'old idea', status: 'cancelled' },
  ]

  it('结果为计数加当前表', () => {
    expect(todoResultText(items)).toBe(
      [
        'Updated todo list: 1 pending, 1 in progress, 1 completed, 1 cancelled.',
        '',
        '- [completed] t1: read the spec',
        '  result: spec has 3 parts',
        '- [in_progress] t2: write tests',
        '- [pending] t3: implement (blocked by t2)',
        '- [cancelled] t4: old idea',
      ].join('\n'),
    )
    expect(todoResultText([])).toBe('Updated todo list: 0 pending, 0 in progress, 0 completed, 0 cancelled.\n\n(empty)')
  })

  it('有未完成项时给出 <todo_list> section；全部 completed / cancelled 或为空时没有', () => {
    const section = todoListSection(items)!
    expect(section.name).toBe(TODO_SECTION_NAME)
    expect(section.text.startsWith('<todo_list>\n')).toBe(true)
    expect(section.text.endsWith('\n</todo_list>')).toBe(true)
    expect(section.text).toContain('- [pending] t3: implement (blocked by t2)')
    expect(section.text).toContain('todo_write')
    const finished: TodoItem[] = items.map(({ blockedBy: _b, ...i }) => (i.status === 'cancelled' ? i : { ...i, status: 'completed' }))
    expect(todoListSection(finished)).toBeUndefined()
    expect(todoListSection([])).toBeUndefined()
  })
})

describe('todo_write 工具', () => {
  const recorder = () => {
    const writes: TodoItem[][] = []
    return { writes, port: { write: async (next: TodoItem[]) => (writes.push(next), next) } }
  }

  it('整表替换：写入规范化后的表，结果为计数与表', async () => {
    const { writes, port } = recorder()
    const tool = createTodoTool(port)
    expect(tool.name).toBe('todo_write')
    const result = await tool.execute('c1', { items: [pending('a', { status: 'in_progress' }), pending('b', { blockedBy: ['t1'] })] })
    expect(writes).toEqual([
      [
        { id: 't1', content: 'a', status: 'in_progress' },
        { id: 't2', content: 'b', status: 'pending', blockedBy: ['t1'] },
      ],
    ])
    expect(result.content).toEqual([{ type: 'text', text: expect.stringMatching(/^Updated todo list: 1 pending, 1 in progress, 0 completed, 0 cancelled\./) }])
  })

  it('违反规则时抛出（作为工具错误回给模型），不写入：原表不变', async () => {
    const { writes, port } = recorder()
    await expect(createTodoTool(port).execute('c1', { items: [pending('a'), pending('a')] })).rejects.toThrow(TodoValidationError)
    expect(writes).toEqual([])
  })

  it('结果文本取自端口实际保存的表（宿主保存前可替换内容）', async () => {
    const tool = createTodoTool({ write: async (next) => next.map((i) => ({ ...i, content: i.content.replace('secret', '[REDACTED]') })) })
    const result = await tool.execute('c1', { items: [pending('use secret')] })
    expect(JSON.stringify(result.content)).toContain('use [REDACTED]')
    expect(JSON.stringify(result.content)).not.toContain('use secret')
  })
})
