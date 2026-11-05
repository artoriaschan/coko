// Shared browser-safe Todo rendering for tool results and State Updates.
interface TodoTextItem {
  id: string
  content: string
  status: string
  blockedBy?: string[]
  result?: string
}

/** 表中每项一行（结果另起一行缩进）；空表为 (empty)。 */
export function formatTodoItems(items: readonly TodoTextItem[]): string {
  if (items.length === 0) return '(empty)'
  return items
    .map((item) => {
      const blocked = item.blockedBy?.length ? ' (blocked by ' + item.blockedBy.join(', ') + ')' : ''
      const line = '- [' + item.status + '] ' + item.id + ': ' + item.content + blocked
      return item.result === undefined ? line : line + '\n  result: ' + item.result
    })
    .join('\n')
}

/** todo_write 的结果：各状态计数加当前表。 */
export function todoResultText(items: readonly TodoTextItem[]): string {
  const count = (status: string) => items.filter((i) => i.status === status).length
  const summary =
    'Updated todo list: ' +
    count('pending') +
    ' pending, ' +
    count('in_progress') +
    ' in progress, ' +
    count('completed') +
    ' completed, ' +
    count('cancelled') +
    ' cancelled.'
  return summary + '\n\n' + formatTodoItems(items)
}
