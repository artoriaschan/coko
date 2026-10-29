import { contextUsageLevel, contextUsagePercent, type ContextBreakdown, type ContextUsageResponse } from '@coko/protocol'
import { ContextRing, HoverCard, HoverCardContent, HoverCardTrigger, type ContextRingLevel } from '@coko/ui'
import * as React from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { useOptionalChatStoreApi } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { targetKey } from '../../stores/commands-store.ts'
import type { ChatActions, ChatState, ChatStore } from '../../stores/chat-store.ts'
import { contextStore as defaultStore, type ContextStore, type ContextTarget } from '../../stores/context-store.ts'

const PARTS: readonly (keyof ContextBreakdown)[] = ['system', 'instructions', 'skills', 'memory', 'tools', 'messages']
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
 * 显示用量、分项、已加载的指令文件与诊断；Esc 关闭并把焦点留在环上。作用域变化、assistant 条目提交、Run 结束与打开卡片时刷新。
 */
export function ContextRingControl({ target, store = defaultStore }: ContextRingControlProps) {
  const { t, locale } = useI18n()
  const key = targetKey(target)
  const usage = useStore(store, (s) => (s.key === key ? s.usage : null))
  const failed = useStore(store, (s) => s.key === key && s.status === 'error' && s.usage === null)
  const signal = useRefreshSignal(target)
  const targetRef = React.useRef(target)
  targetRef.current = target
  const refresh = React.useCallback(() => void store.getState().load(targetRef.current), [store])
  React.useEffect(() => {
    refresh()
  }, [refresh, key, signal])

  const [open, setOpen] = React.useState(false)
  const trigger = React.useRef<HTMLButtonElement>(null)
  // 只由点击（含 Enter / 空格）打开：悬停打开会在布局变化把环移到静止的指针下时弹出卡片，遮住输入区上方的横幅与按钮。
  // Radix 的悬停关闭（指针离开环与卡片）、外部点击与 Esc 照常关闭。
  const onOpenChange = (next: boolean) => {
    if (!next) setOpen(false)
  }
  const toggle = (next: boolean) => {
    setOpen(next)
    if (next) refresh()
  }

  const percent = usage ? contextUsagePercent(usage) : undefined
  const level = usage ? RING_LEVEL[contextUsageLevel(usage)] : 'normal'
  const label = percent === undefined ? t('context.ring.unknown') : t('context.ring.label', { percent: String(percent) })
  const number = React.useMemo(() => new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US'), [locale])

  return (
    <HoverCard open={open} onOpenChange={onOpenChange}>
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
      <HoverCardContent
        side="top"
        align="end"
        role="dialog"
        aria-label={t('context.card.title')}
        data-slot="context-card"
        className="w-80"
        onEscapeKeyDown={() => trigger.current?.focus()}
      >
        {usage ? (
          <ContextDetails usage={usage} format={(n) => number.format(n)} />
        ) : (
          <p className="text-ui-small text-muted-foreground">{failed ? t('context.card.loadFailed') : '…'}</p>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}

function ContextDetails({ usage, format }: { usage: ContextUsageResponse; format: (n: number) => string }) {
  const { t } = useI18n()
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <p className="font-medium">{t('context.card.title')}</p>
        {usage.contextWindow > 0 && (
          <p data-slot="context-usage" className="text-ui-small tabular-nums">
            {t('context.card.usage', { tokens: format(usage.tokens), window: format(usage.contextWindow) })}
            {usage.estimated && <span className="text-muted-foreground"> · {t('context.card.estimated')}</span>}
          </p>
        )}
        {usage.contextWindow > 0 && (
          <p className="text-ui-small text-muted-foreground tabular-nums">
            {usage.autoCompact.enabled
              ? usage.autoCompact.paused
                ? t('context.card.autoCompactPaused')
                : t('context.card.thresholds', { threshold: format(usage.threshold), warning: format(usage.warning) })
              : t('context.card.autoCompactOff')}
          </p>
        )}
      </div>
      <section aria-label={t('context.card.breakdown')} className="flex flex-col gap-1">
        <p className="text-ui-small text-muted-foreground">{t('context.card.breakdown')}</p>
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-ui-small tabular-nums">
          {PARTS.map((part) => (
            <React.Fragment key={part}>
              <dt data-part={part}>{t(`context.card.parts.${part}`)}</dt>
              <dd className="text-right text-muted-foreground">{format(usage.breakdown[part])}</dd>
            </React.Fragment>
          ))}
        </dl>
      </section>
      <section aria-label={t('context.card.instructions')} className="flex flex-col gap-1">
        <p className="text-ui-small text-muted-foreground">{t('context.card.instructions')}</p>
        {usage.instructions.length === 0 ? (
          <p className="text-ui-small text-muted-foreground">{t('context.card.noInstructions')}</p>
        ) : (
          <ul className="flex flex-col gap-0.5 text-ui-small">
            {usage.instructions.map((file) => (
              <li key={file.path} data-instruction-file={file.path} className="flex min-w-0 items-baseline gap-2">
                <span data-user-content="" className="min-w-0 flex-1 truncate" title={file.path}>
                  {file.path}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {t(`context.card.scopes.${file.scope}`)}
                  {file.truncated && <span className="text-warning"> · {t('context.card.truncated')}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {usage.diagnostics.length > 0 && (
        <section aria-label={t('context.card.diagnostics')} className="flex flex-col gap-1">
          <p className="text-ui-small text-muted-foreground">{t('context.card.diagnostics')}</p>
          <ul className="flex flex-col gap-1 text-ui-small">
            {usage.diagnostics.map((d, index) => (
              <li key={`${d.source}:${d.code}:${d.path ?? ''}:${index}`} data-diagnostic={d.code} className="flex flex-col">
                <span className="text-warning">{d.code}</span>
                <span data-user-content="" className="break-words text-muted-foreground">
                  {d.path ? `${d.path}: ${d.message}` : d.message}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
