import type { TodoItem, TodoStatus } from '@coko/protocol'
import { IconChevronDown, IconCircleCheck, IconCircleDot, IconCircle, IconCircleX, IconChecklist } from '@tabler/icons-react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { useChat } from '../../../app/chat.tsx'
import { useI18n } from '../../../app/i18n.tsx'
import type { DockCardProps } from './dock-slots.ts'

/** 各会话的展开状态：只在 renderer 内存中，不入记录（缺省收起）。 */
const expandedStore = createStore<Record<string, boolean>>(() => ({}))

const finished = (status: TodoStatus) => status === 'completed' || status === 'cancelled'

const STATUS_ICON = {
  pending: <IconCircle aria-hidden className="size-4 shrink-0 text-muted-foreground" />,
  in_progress: <IconCircleDot aria-hidden className="size-4 shrink-0 text-primary" />,
  completed: <IconCircleCheck aria-hidden className="size-4 shrink-0 text-muted-foreground" />,
  cancelled: <IconCircleX aria-hidden className="size-4 shrink-0 text-muted-foreground" />,
} as const satisfies Record<TodoStatus, React.ReactNode>

/**
 * 最新的 todo_list 条目及其之后是否开始过 Run；没有时 undefined。返回 store 中的引用（条目对象本身）与一个数，选择器结果稳定。
 */
function useLatestList(sessionId: string): { items: TodoItem[]; runAfter: boolean } | undefined {
  const entry = useChat((state) => {
    const entries = state.conversations[sessionId]?.entries
    if (!entries) return undefined
    for (let i = entries.length - 1; i >= 0; i--) if (entries[i]!.kind === 'todo_list') return entries[i]
    return undefined
  })
  const lastRunStart = useChat((state) => {
    const entries = state.conversations[sessionId]?.entries ?? []
    for (let i = entries.length - 1; i >= 0; i--) if (entries[i]!.kind === 'run_start') return entries[i]!.seq
    return 0
  })
  if (!entry || entry.kind !== 'todo_list') return undefined
  return { items: entry.payload.items, runAfter: lastRunStart > entry.seq }
}

function TodoRow({ item, open }: { item: TodoItem; open: readonly string[] }) {
  const { t } = useI18n()
  const waiting = item.status === 'pending' ? (item.blockedBy ?? []).filter((id) => open.includes(id)) : []
  const body = (
    <>
      {STATUS_ICON[item.status]}
      <span className="sr-only">{t(`todo.status.${item.status}`)}</span>
      <span
        className={`min-w-0 flex-1 break-words ${finished(item.status) ? 'text-muted-foreground' : ''} ${item.status === 'cancelled' ? 'line-through' : ''}`}
      >
        {item.content}
      </span>
      {waiting.length > 0 && (
        <span data-todo-waiting className="shrink-0 text-ui-small text-muted-foreground">
          {t('todo.waitingFor', { ids: waiting.join(', ') })}
        </span>
      )}
    </>
  )
  if (item.result === undefined)
    return (
      <li data-todo-item={item.id} data-status={item.status} className="flex items-start gap-2 py-0.5">
        {body}
      </li>
    )
  return (
    <li data-todo-item={item.id} data-status={item.status}>
      <details className="group/result">
        <summary className="flex cursor-pointer items-start gap-2 rounded-sm py-0.5 select-none focus-ring [&::-webkit-details-marker]:hidden">
          {body}
          <IconChevronDown
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground transition-transform group-open/result:rotate-180 motion-reduce:transition-none"
          />
        </summary>
        <p data-todo-result className="ms-6 mt-0.5 mb-1 text-ui-small break-words whitespace-pre-wrap text-muted-foreground">
          {item.result}
        </p>
      </details>
    </li>
  )
}

/**
 * dock 的待办卡：标题"待办 c/n"与当前 in_progress 项；展开后为整张表（状态图标、等待中的前置项、完成项可展开 result）。
 * 全部完成或取消时只显示一行"全部完成"，下一个 Run 开始后隐藏。没有表或表为空时不显示。
 */
export function TodoCard({ sessionId }: DockCardProps) {
  const { t } = useI18n()
  const list = useLatestList(sessionId)
  const expanded = useStore(expandedStore, (s) => s[sessionId] ?? false)
  if (!list || list.items.length === 0) return null
  const { items } = list
  const allDone = items.every((i) => finished(i.status))
  if (allDone && list.runAfter) return null
  const done = items.filter((i) => finished(i.status)).length
  const current = items.find((i) => i.status === 'in_progress')
  const open = items.filter((i) => !finished(i.status)).map((i) => i.id)
  const showList = expanded && !allDone
  return (
    <section
      data-slot="todo-card"
      data-all-done={allDone || undefined}
      aria-label={t('todo.card')}
      className="rounded-panel bg-background px-3 py-2 text-ui-body shadow-panel"
    >
      <button
        type="button"
        data-action="toggle-todo"
        aria-expanded={showList}
        aria-label={t('todo.toggle')}
        disabled={allDone}
        onClick={() => expandedStore.setState({ [sessionId]: !expanded })}
        className="flex w-full min-w-0 items-center gap-2 rounded-sm text-start focus-ring disabled:cursor-default"
      >
        <IconChecklist aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span data-todo-count className="shrink-0 font-medium">
          {t('todo.count', { done, total: items.length })}
        </span>
        <span data-todo-current className="min-w-0 flex-1 truncate text-muted-foreground">
          {allDone ? t('todo.allDone') : (current?.content ?? '')}
        </span>
        {!allDone && (
          <IconChevronDown
            aria-hidden
            className={`size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${showList ? 'rotate-180' : ''}`}
          />
        )}
      </button>
      {showList && (
        <ul data-todo-list className="mt-1.5 max-h-60 overflow-y-auto">
          {items.map((item) => (
            <TodoRow key={item.id} item={item} open={open} />
          ))}
        </ul>
      )}
    </section>
  )
}
