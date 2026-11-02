import { contextUsageLevel, contextUsagePercent, type ContextBreakdown, type ContextUsageResponse } from '@coko/protocol'
import { ContextRing, HoverCard, HoverCardContent, HoverCardTrigger, Tooltip, TooltipContent, TooltipTrigger, type ContextRingLevel } from '@coko/ui'
import { CirclePauseIcon } from 'lucide-react'
import * as React from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { useNewChat, useLists, useOptionalChatStoreApi } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { useSettings } from '../../app/settings.tsx'
import { targetKey } from '../../stores/commands-store.ts'
import type { ChatActions, ChatState, ChatStore } from '../../stores/chat-store.ts'
import { contextStore as defaultStore, type ContextStore, type ContextTarget } from '../../stores/context-store.ts'

const PARTS = ['system', 'prompt', 'assistant', 'thinking', 'tools'] as const satisfies readonly (keyof ContextBreakdown)[]
const PART_COLOR = { system: 'bg-muted-foreground', prompt: 'bg-success', assistant: 'bg-link', thinking: 'bg-terminal-magenta', tools: 'bg-warning' } as const
const RING_LEVEL = { normal: 'normal', warning: 'warning', critical: 'critical' } as const satisfies Record<string, ContextRingLevel>

/** 没有对话 store（composer 的组件测试）时的空 store：刷新信号恒定。 */
const NO_CHAT = createStore(() => ({ conversations: {} }) as unknown as ChatState & ChatActions) as ChatStore

/**
 * 刷新信号：会话中已提交的 assistant 条目数（每条 assistant 提交后 Sidecar 发出 context_usage）与 Run 是否进行中（run_end 后刷新）。
 * 草稿没有会话，信号恒定。
 */
function useRefreshSignal(target: ContextTarget): string {
  const chat = useOptionalChatStoreApi() ?? NO_CHAT
  const sessionId = 'sessionId' in target ? target.sessionId : undefined
  return useStore(chat, (state) => {
    const conversation = sessionId === undefined ? undefined : state.conversations[sessionId]
    if (!conversation) return ''
    let assistants = 0
    for (const entry of conversation.entries) if (entry.kind === 'message' && entry.payload.role === 'assistant') assistants++
    return `${assistants}:${conversation.running ? 1 : 0}`
  })
}

export interface ContextRingControlProps {
  target: ContextTarget
  /** 测试注入；缺省应用内共用的 store。 */
  store?: ContextStore
}

/**
 * 输入区底栏的上下文环：百分比与颜色（越过预警线为 warning，达到自动压缩阈值为 destructive）。点击打开 HoverCard，
 * 显示用量与五类分项；Esc 关闭并把焦点留在环上。作用域变化、assistant 条目提交、Run 结束与打开卡片时刷新。
 */
export function ContextRingControl({ target, store = defaultStore }: ContextRingControlProps) {
  const { t, locale } = useI18n()
  const key = targetKey(target)
  const usage = useStore(store, (s) => (s.key === key ? s.usage : null))
  const failed = useStore(store, (s) => s.key === key && s.status === 'error' && s.usage === null)
  // 压缩结束（成功或失败）也刷新：熔断状态只在用量接口中。
  const compactions = useStore(store, (s) => s.compactionRevision)
  const signal = `${useRefreshSignal(target)}:${compactions}`
  const targetRef = React.useRef(target)
  targetRef.current = target
  const refresh = React.useCallback(() => void store.getState().load(targetRef.current), [store])
  React.useEffect(() => {
    refresh()
  }, [refresh, key, signal])

  const [open, setOpen] = React.useState(false)
  const [tooltipOpen, setTooltipOpen] = React.useState(false)
  const trigger = React.useRef<HTMLButtonElement>(null)
  // 只由点击（含 Enter / 空格）打开：悬停打开会在布局变化把环移到静止的指针下时弹出卡片，遮住输入区上方的横幅与按钮。
  // Radix 的悬停关闭（指针离开环与卡片）、外部点击与 Esc 照常关闭。
  const onOpenChange = (next: boolean) => {
    if (!next) setOpen(false)
  }
  const toggle = (next: boolean) => {
    setOpen(next)
    if (next) {
      setTooltipOpen(false)
      refresh()
    }
  }

  const hasChat = useOptionalChatStoreApi() !== null
  const percent = usage ? contextUsagePercent(usage) : undefined
  const level = usage ? RING_LEVEL[contextUsageLevel(usage)] : 'normal'
  const label = t('context.ring.unknown')
  const hint = percent === undefined ? label : t('context.ring.label', { percent: String(percent) })
  const number = React.useMemo(() => new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US'), [locale])

  const paused = usage?.autoCompact.enabled === true && usage.autoCompact.paused
  return (
    <>
      {paused && (
        // 熔断：连续 3 次自动压缩失败后暂停，提示用 /compact 手动压缩。
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              role="img"
              tabIndex={0}
              aria-label={t('context.compaction.pausedHint')}
              data-slot="auto-compact-paused"
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-warning focus-ring"
            >
              <CirclePauseIcon aria-hidden className="size-4" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">{t('context.compaction.pausedHint')}</TooltipContent>
        </Tooltip>
      )}
      <HoverCard open={open} onOpenChange={onOpenChange}>
        <Tooltip open={!open && tooltipOpen} onOpenChange={setTooltipOpen}>
          <TooltipTrigger asChild>
            <HoverCardTrigger asChild>
              <ContextRing
                ref={trigger}
                percent={percent}
                level={level}
                label={label}
                aria-expanded={open}
                aria-haspopup="dialog"
                onClick={() => toggle(!open)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && open) {
                    event.preventDefault()
                    event.stopPropagation()
                    toggle(false)
                  }
                }}
              />
            </HoverCardTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">{hint}</TooltipContent>
        </Tooltip>
        <HoverCardContent
          side="top"
          align="end"
          role="dialog"
          aria-label={t('context.card.title')}
          data-slot="context-card"
          sideOffset={8}
          className="h-96 w-[348px] max-h-(--radix-hover-card-content-available-height) overflow-y-auto px-4 py-3"
          onEscapeKeyDown={() => trigger.current?.focus()}
          onPointerDownOutside={(event) => {
            // 阻止 pointerdown 默认的焦点移动；随后的 click 仍可激活外部操作。
            event.preventDefault()
            event.detail.originalEvent.preventDefault()
            toggle(false)
            trigger.current?.focus()
          }}
        >
          {usage ? (
            <ContextDetails usage={usage} format={(n) => number.format(n)} model={hasChat ? <CurrentModelLabel target={target} /> : null} />
          ) : (
            <p className="text-ui-small text-muted-foreground">{failed ? t('context.card.loadFailed') : '…'}</p>
          )}
        </HoverCardContent>
      </HoverCard>
    </>
  )
}

function CurrentModelLabel({ target }: { target: ContextTarget }) {
  const session = useLists((state) => ('sessionId' in target ? state.sessions.find((item) => item.id === target.sessionId) : undefined))
  const draft = useNewChat((state) => state.model)
  const models = useSettings((state) => state.models)
  const fallback = useSettings((state) => state.defaultModel)
  const value = session ? (session.model ?? (session.modelCleared ? null : fallback)) : (draft ?? fallback)
  const current = models.find((model) => model.providerId === value?.providerId && model.modelId === value?.modelId)
  return (
    <span data-user-content className="truncate">
      {current?.name ?? value?.modelId}
    </span>
  )
}

function ContextDetails({ usage, format, model }: { usage: ContextUsageResponse; format: (n: number) => string; model: React.ReactNode }) {
  const { t, locale } = useI18n()
  const percent = contextUsagePercent(usage)
  const percentage = (tokens: number, total: number) =>
    new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
      total > 0 ? (tokens / total) * 100 : 0,
    )
  return (
    <div className="flex h-full flex-col">
      <p className="font-medium">{t('context.card.title')}</p>
      <p className="mt-1.5 flex min-w-0 items-center gap-1 text-ui-small text-muted-foreground">
        {model}
        {model && <span aria-hidden>·</span>}
        <span>{t('context.card.window', { window: format(usage.contextWindow) })}</span>
      </p>
      <div className="mt-4 flex items-baseline justify-between gap-2">
        <p className="shrink-0 font-medium">{percent === undefined ? '—' : t('context.card.used', { percent: String(percent) })}</p>
        <p data-slot="context-usage" className="text-right font-mono text-ui-small text-muted-foreground">
          {t('context.card.usage', { tokens: format(usage.tokens), window: format(usage.contextWindow) })}
        </p>
      </div>
      <div aria-hidden data-slot="context-capacity" className="mt-4 flex h-1.5 shrink-0 overflow-hidden rounded-round bg-accent">
        {PARTS.map((part) => (
          <span
            key={part}
            data-capacity-part={part}
            className={PART_COLOR[part]}
            style={{ width: `${usage.contextWindow > 0 ? (usage.breakdown[part] / usage.contextWindow) * 100 : 0}%` }}
          />
        ))}
      </div>
      <dl aria-label={t('context.card.breakdown')} className="mt-3 flex flex-1 flex-col justify-between">
        {PARTS.map((part) => (
          <div key={part} className="grid grid-cols-[12px_1fr_auto] items-center gap-x-2">
            <span aria-hidden className={`size-2 rounded-round ${PART_COLOR[part]}`} />
            <dt data-part={part}>{t(`context.card.parts.${part}`)}</dt>
            <dd data-part-value={part} className="text-right font-mono text-ui-small">
              {format(usage.breakdown[part])} · {percentage(usage.breakdown[part], usage.tokens)}%
            </dd>
            <dd className="col-span-2 col-start-2 mt-0.5 text-ui-caption text-muted-foreground">{t(`context.card.descriptions.${part}`)}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex items-baseline justify-between gap-2 border-t-hairline border-border pt-2 text-ui-small">
        <p className="text-muted-foreground">{t('context.card.compactAt')}</p>
        <p className="text-right font-mono">
          {format(usage.threshold)} ({usage.contextWindow > 0 ? Math.floor((usage.threshold / usage.contextWindow) * 100) : 0}%)
        </p>
      </div>
    </div>
  )
}
