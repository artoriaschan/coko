import {
  GOAL_BUDGET_DIMENSION_KEYS,
  type GoalActionRequest,
  type GoalBudget,
  type GoalBudgetDimension,
  type GoalPayload,
  type GoalPhase,
  type GoalUsage,
  type SessionEntry,
} from '@coko/protocol'
import type { MessageKey, Translator } from '@coko/i18n'
import { Button, cn, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Textarea, toast } from '@coko/ui'
import { ChevronDownIcon, CircleCheckIcon, CircleIcon, LoaderCircleIcon, TargetIcon, XIcon } from 'lucide-react'
import * as React from 'react'
import { useStore } from 'zustand'
import { useChat } from '../../../app/chat.tsx'
import { useI18n } from '../../../app/i18n.tsx'
import { IconButton } from '../../../app/icon-button.tsx'
import { ApiError } from '../../../client/api.ts'
import { goalStore, type GoalActions, type GoalActionName, type GoalState, type GoalStore } from '../../../stores/goal-store.ts'
import { formatJobDuration } from '../jobs-button.tsx'
import { formatCost, formatCount, useCurrency } from '../session-cost.tsx'
import type { DockCardProps } from './dock-slots.ts'

// dock 的 Goal 卡（docs/subsystems/goal.md#界面）：Goal 快照取自会话中最新的 goal 条目，已用量取自 GET …/goal（影响用量的条目到达时重新读取），
// 动作经 POST …/goal（带当前 revision）。卡片的展开、经 /goal 打开与关闭只在 renderer 内存中。

const GoalStoreContext = React.createContext<GoalStore>(goalStore)

export function GoalStoreProvider({ store, children }: { store: GoalStore; children: React.ReactNode }) {
  return <GoalStoreContext.Provider value={store}>{children}</GoalStoreContext.Provider>
}

export const useGoalStoreApi = (): GoalStore => React.useContext(GoalStoreContext)

function useGoals<T>(selector: (state: GoalState & GoalActions) => T): T {
  return useStore(useGoalStoreApi(), selector)
}

/** 独占整段输入的 /goal（无参数）：界面打开 Goal 卡，不发送。 */
export const isGoalCardCommand = (text: string) => /^\/goal\s*$/.test(text.trim())

/** /goal pause 与 /goal cancel：Run 进行中作为提交（Sidecar 的动作）而不是追加指令发送。 */
export const isGoalRunningControl = (text: string) => /^\/goal\s+(pause|cancel)\s*$/i.test(text.trim())

const TERMINAL: readonly GoalPhase[] = ['complete', 'cancelled']
const isTerminal = (phase: GoalPhase) => TERMINAL.includes(phase)

/** 未设 maxRounds 的快照按缺省 50 显示（与 Sidecar 一致）。 */
const DEFAULT_MAX_ROUNDS = 50

const NO_ENTRIES: SessionEntry[] = []

function latestGoalEntry(entries: readonly SessionEntry[]): Extract<SessionEntry, { kind: 'goal' }> | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!
    if (entry.kind === 'goal') return entry
  }
  return undefined
}

/**
 * 影响已用量的条目数：goal（阶段与 Goal 的归属）、run_end（时间）、compaction 与带 usage 的 assistant 消息（Token 与费用）。工具结果之后总有
 * 一条带 usage 的 assistant 消息或 run_end，不单独重读。
 */
function usageChanges(entries: readonly SessionEntry[]): number {
  let count = 0
  for (const entry of entries) {
    if (entry.kind === 'goal' || entry.kind === 'run_end' || entry.kind === 'compaction') count++
    else if (entry.kind === 'message') {
      const message = entry.payload as { role?: unknown; usage?: unknown }
      if (message.role === 'assistant' && message.usage !== undefined) count++
    }
  }
  return count
}

function lastRunStartSeq(entries: readonly SessionEntry[]): number {
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i]!.kind === 'run_start') return entries[i]!.seq
  return 0
}

/** 该 Goal 已开始的 Goal Round 数（run_start.goal.round 的最大值）。 */
function goalRound(entries: readonly SessionEntry[], goalId: string): number {
  let round = 0
  for (const entry of entries) if (entry.kind === 'run_start' && entry.payload.goal?.goalId === goalId) round = Math.max(round, entry.payload.goal.round)
  return round
}

// ---- 阶段、原因与预算 ----

const PHASE_DOT: Record<GoalPhase, string> = {
  running: 'bg-success',
  'waiting-input': 'bg-primary',
  'waiting-external': 'bg-primary',
  paused: 'bg-muted-foreground',
  blocked: 'bg-warning',
  failed: 'bg-destructive',
  'budget-exhausted': 'bg-warning',
  complete: 'bg-success',
  cancelled: 'bg-muted-foreground',
}

/** 阶段徽标：状态点与阶段名（颜色之外有文字）。 */
export function GoalPhaseBadge({ phase, className }: { phase: GoalPhase; className?: string }) {
  const { t } = useI18n()
  return (
    <span
      data-slot="goal-phase"
      data-phase={phase}
      className={cn('inline-flex h-5 shrink-0 items-center gap-1.5 rounded-xs bg-muted px-1.5 text-ui-small whitespace-nowrap text-foreground', className)}
    >
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-round', PHASE_DOT[phase])} />
      {t(`goal.phase.${phase}`)}
    </span>
  )
}

/** 带模型给出的说明的原因：文案之后附上原文（用户内容）。 */
const DETAILED_REASONS = new Set(['needs-input', 'model-blocked', 'model-paused'])

/** 阶段原因的文案：已知的 reason.code 取字典；Run 的错误码显示"运行出错"并附上错误消息。 */
export function goalReasonText(t: Translator, dictionary: { goal: { reason: Record<string, string> } }, reason: GoalPayload['reason']) {
  if (!reason) return undefined
  if (reason.code in dictionary.goal.reason && reason.code !== 'error')
    return {
      text: t(`goal.reason.${reason.code}` as MessageKey),
      detail: DETAILED_REASONS.has(reason.code) && reason.message !== '' ? reason.message : undefined,
    }
  return { text: t('goal.reason.error'), detail: reason.message === '' ? undefined : reason.message }
}

type Dimension = GoalBudgetDimension

/** 每个预算维度在卡片上的上限与已用量；键与顺序取自协议的 GOAL_BUDGET_DIMENSION_KEYS（新增维度时这里缺项是编译错误）。 */
const DIMENSION_VALUES: Record<Dimension, { max: (b: GoalBudget) => number | undefined; used: (u: GoalUsage, round: number) => number | undefined }> = {
  rounds: { max: (b) => b.maxRounds ?? DEFAULT_MAX_ROUNDS, used: (u, round) => Math.max(u.rounds, round) },
  'tool-calls': { max: (b) => b.maxToolCalls, used: (u) => u.toolCalls },
  tokens: { max: (b) => b.maxTokens, used: (u) => u.tokens },
  cost: { max: (b) => b.maxCost, used: (u) => u.cost },
  time: { max: (b) => b.maxDurationMs, used: (u) => u.durationMs },
}
const DIMENSIONS = GOAL_BUDGET_DIMENSION_KEYS.map((id) => ({ id, ...DIMENSION_VALUES[id] }))

export type BudgetLevel = 'normal' | 'warning' | 'exhausted'

/** 已用 / 上限 ≥ 80% 为 warning，≥ 100% 为 exhausted。 */
export const budgetLevel = (used: number, max: number): BudgetLevel => (used >= max ? 'exhausted' : used >= max * 0.8 ? 'warning' : 'normal')

const LEVEL_FILL: Record<BudgetLevel, string> = { normal: 'bg-primary', warning: 'bg-warning', exhausted: 'bg-destructive' }
const LEVEL_TEXT: Record<BudgetLevel, string> = { normal: 'text-muted-foreground', warning: 'text-warning-text', exhausted: 'text-destructive' }

/** budget-exhausted 时仍有已设维度达到上限：恢复会被拒绝（409），先调高预算。 */
function exhaustedNow(goal: GoalPayload, usage: GoalUsage | undefined, round: number): boolean {
  if (!usage) return false
  return DIMENSIONS.some((d) => {
    const max = d.max(goal.budget)
    const used = d.used(usage, round)
    return max !== undefined && used !== undefined && used >= max
  })
}

// ---- 卡片 ----

/** 目标文本：两行截断；超出时可展开全文。 */
function ClampedText({ text, className }: { text: string; className?: string }) {
  const { t } = useI18n()
  const ref = React.useRef<HTMLParagraphElement>(null)
  const [open, setOpen] = React.useState(false)
  const [overflowing, setOverflowing] = React.useState(false)
  // 只有渲染后才知道是否超出两行：测量 scrollHeight（ResizeObserver 跟随宽度变化）。展开时保留按钮以便收起。
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el || open) return
    const measure = () => setOverflowing(el.scrollHeight > el.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text, open])
  return (
    <div className={cn('min-w-0', className)}>
      <p ref={ref} data-user-content data-slot="goal-objective" className={cn('break-words whitespace-pre-wrap', !open && 'line-clamp-2')}>
        {text}
      </p>
      {(overflowing || open) && (
        <Button variant="link" size="sm" className="h-auto px-0 text-ui-small" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? t('goal.showLess') : t('goal.showMore')}
        </Button>
      )}
    </div>
  )
}

function BudgetRow({ id, used, max, unpriced }: { id: Dimension; used: number | undefined; max: number; unpriced: boolean }) {
  const { t, locale } = useI18n()
  const currency = useCurrency()
  const format = (value: number) =>
    id === 'cost' ? formatCost(locale, currency, value) : id === 'time' ? formatJobDuration(t, value) : formatCount(locale, value)
  const label = t(`goal.dimension.${id}`)
  // 未定价：费用按 0 计，不画进度，改为提示。
  if (id === 'cost' && unpriced && !used)
    return (
      <li data-budget={id} data-unpriced className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-baseline justify-between gap-2">
          <span>{label}</span>
          <span className="text-ui-small text-muted-foreground tabular-nums">{t('goal.budgetUsage', { used: t('usage.unpriced'), max: format(max) })}</span>
        </div>
        <p className="text-ui-small text-warning-text">{t('goal.unpricedHint')}</p>
      </li>
    )
  const value = used ?? 0
  const level = budgetLevel(value, max)
  const ratio = Math.min(1, value / max)
  const text = t('goal.budgetUsage', { used: format(value), max: format(max) })
  return (
    <li data-budget={id} data-level={level} className="flex min-w-0 flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span>{label}</span>
        <span data-budget-value className={cn('text-ui-small tabular-nums', LEVEL_TEXT[level])}>
          {text}
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.min(value, max)}
        aria-valuetext={text}
        className="h-1 overflow-hidden rounded-round bg-muted"
        // 进度只经局部变量传入（设计系统：动态行内样式只传测量值或局部变量）。
        style={{ '--local-fill': `${ratio * 100}%` } as React.CSSProperties}
      >
        <div data-budget-fill className={cn('h-full w-(--local-fill) rounded-round', LEVEL_FILL[level])} />
      </div>
    </li>
  )
}

function useGoalAction(sessionId: string, goal: GoalPayload) {
  const { t } = useI18n()
  const store = useGoalStoreApi()
  return React.useCallback(
    async (action: GoalActionName, extra: Omit<GoalActionRequest, 'action' | 'revision'> = {}): Promise<boolean> => {
      try {
        await store.getState().act(sessionId, { action, revision: goal.revision, ...extra })
        return true
      } catch (error) {
        if (error instanceof ApiError && error.code === 'revision-conflict') {
          toast.error(t('goal.conflict'))
          void store.getState().load(sessionId)
        } else toast.error(t('goal.actionFailed', { message: error instanceof Error ? error.message : String(error) }))
        return false
      }
    },
    [store, sessionId, goal.revision, t],
  )
}

/** 预算输入：空为不设上限；有值时须为正（整数维度为正整数）。 */
function parseLimit(text: string, integer: boolean): number | undefined | null {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null
  const value = Number(trimmed)
  if (!(value > 0) || (integer && !Number.isInteger(value))) return null
  return value
}

type EditField = 'maxRounds' | 'maxToolCalls' | 'maxTokens' | 'maxCost' | 'maxMinutes'
const EDIT_FIELDS: readonly { id: EditField; integer: boolean }[] = [
  { id: 'maxRounds', integer: true },
  { id: 'maxToolCalls', integer: true },
  { id: 'maxTokens', integer: true },
  { id: 'maxCost', integer: false },
  { id: 'maxMinutes', integer: false },
]

const initialFields = (budget: GoalBudget): Record<EditField, string> => ({
  maxRounds: budget.maxRounds === undefined ? '' : String(budget.maxRounds),
  maxToolCalls: budget.maxToolCalls === undefined ? '' : String(budget.maxToolCalls),
  maxTokens: budget.maxTokens === undefined ? '' : String(budget.maxTokens),
  maxCost: budget.maxCost === undefined ? '' : String(budget.maxCost),
  maxMinutes: budget.maxDurationMs === undefined ? '' : String(Math.round((budget.maxDurationMs / 60_000) * 100) / 100),
})

/** 编辑目标与预算：budget 整体替换（Sidecar 的 edit）；每次打开从当前快照重新载入。 */
function GoalEditDialog({ goal, open, onClose, act }: { goal: GoalPayload; open: boolean; onClose: () => void; act: ReturnType<typeof useGoalAction> }) {
  const { t } = useI18n()
  const currency = useCurrency()
  const baseId = React.useId()
  const [objective, setObjective] = React.useState(goal.objective)
  const [fields, setFields] = React.useState(() => initialFields(goal.budget))
  const [saving, setSaving] = React.useState(false)
  const [submitted, setSubmitted] = React.useState(false)
  const parsed = EDIT_FIELDS.map((f) => [f.id, parseLimit(fields[f.id], f.integer)] as const)
  const invalid = new Set(parsed.filter(([, v]) => v === null).map(([id]) => id))
  const objectiveMissing = objective.trim() === ''
  const symbol = currency === 'CNY' ? '¥' : '$'
  const submit = async () => {
    setSubmitted(true)
    if (invalid.size > 0 || objectiveMissing) return
    const value = Object.fromEntries(parsed) as Record<EditField, number | undefined>
    const budget: GoalBudget = {
      ...(value.maxRounds === undefined ? {} : { maxRounds: value.maxRounds }),
      ...(value.maxToolCalls === undefined ? {} : { maxToolCalls: value.maxToolCalls }),
      ...(value.maxTokens === undefined ? {} : { maxTokens: value.maxTokens }),
      ...(value.maxCost === undefined ? {} : { maxCost: value.maxCost }),
      ...(value.maxMinutes === undefined ? {} : { maxDurationMs: Math.max(1, Math.round(value.maxMinutes * 60_000)) }),
    }
    setSaving(true)
    const ok = await act('edit', { ...(objective.trim() === goal.objective ? {} : { objective: objective.trim() }), budget })
    setSaving(false)
    if (ok) onClose()
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('goal.edit.close')} data-slot="goal-edit-dialog" className="max-w-[520px] gap-4 p-6">
        <div className="flex flex-col gap-1 pe-8">
          <DialogTitle>{t('goal.edit.title')}</DialogTitle>
          <DialogDescription>{t('goal.edit.description')}</DialogDescription>
        </div>
        <form
          className="flex min-h-0 flex-col gap-4 overflow-y-auto"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${baseId}-objective`} className="text-ui-body font-medium">
              {t('goal.edit.objective')}
            </label>
            <Textarea
              id={`${baseId}-objective`}
              data-user-content
              data-field="objective"
              value={objective}
              aria-invalid={(submitted && objectiveMissing) || undefined}
              onChange={(event) => setObjective(event.target.value)}
            />
            {submitted && objectiveMissing && <p className="text-ui-small text-destructive">{t('goal.edit.required')}</p>}
          </div>
          <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2">
            {EDIT_FIELDS.map((f) => {
              const id = `${baseId}-${f.id}`
              const bad = submitted && invalid.has(f.id)
              return (
                <div key={f.id} className="flex min-w-0 flex-col gap-1.5">
                  <label htmlFor={id} className="text-ui-body">
                    {f.id === 'maxCost' ? t('goal.edit.maxCost', { symbol }) : t(`goal.edit.${f.id}`)}
                  </label>
                  <Input
                    id={id}
                    data-field={f.id}
                    inputMode={f.integer ? 'numeric' : 'decimal'}
                    placeholder={f.id === 'maxRounds' ? String(DEFAULT_MAX_ROUNDS) : undefined}
                    value={fields[f.id]}
                    aria-invalid={bad || undefined}
                    onChange={(event) => setFields({ ...fields, [f.id]: event.target.value })}
                  />
                  {bad && <p className="text-ui-small text-destructive">{f.integer ? t('goal.edit.invalidInteger') : t('goal.edit.invalidNumber')}</p>}
                </div>
              )
            })}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('goal.edit.cancel')}
            </Button>
            <Button type="submit" data-action="save-goal" disabled={saving}>
              {saving && <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />}
              {t('goal.edit.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** 取消确认：进行中的 Run 与该 Goal 的后台任务一起停止；请求在清理完成后返回，期间显示"正在停止"。 */
function GoalCancelDialog({ open, onClose, act, pending }: { open: boolean; onClose: () => void; act: ReturnType<typeof useGoalAction>; pending: boolean }) {
  const { t } = useI18n()
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent data-slot="goal-cancel-dialog" role="alertdialog" className="max-w-[440px] gap-4 p-6">
        <div className="flex flex-col gap-1">
          <DialogTitle>{t('goal.cancelConfirm.title')}</DialogTitle>
          <DialogDescription>{t('goal.cancelConfirm.body')}</DialogDescription>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('goal.cancelConfirm.keep')}
          </Button>
          <Button variant="destructive" data-action="confirm-cancel-goal" disabled={pending} onClick={() => void act('cancel').then((ok) => ok && onClose())}>
            {pending && <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />}
            {pending ? t('goal.cancelConfirm.cancelling') : t('goal.cancelConfirm.confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function CloseButton({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  return (
    <IconButton label={t('goal.action.close')} size="icon-sm" data-action="close-goal" onClick={onClose}>
      <XIcon />
    </IconButton>
  )
}

interface GoalBodyProps {
  sessionId: string
  goal: GoalPayload
  round: number
  usage: GoalUsage | undefined
  expanded: boolean
  pending: GoalActionName | undefined
  onToggle: () => void
  onClose: (() => void) | undefined
}

function GoalBody({ sessionId, goal, round, usage, expanded, pending, onToggle, onClose }: GoalBodyProps) {
  const { t, locale, dictionary } = useI18n()
  const currency = useCurrency()
  const act = useGoalAction(sessionId, goal)
  const [dialog, setDialog] = React.useState<{ kind: 'edit' | 'cancel'; opened: number } | null>(null)
  const phase = goal.phase
  const terminal = isTerminal(phase)
  const reason = goalReasonText(t, dictionary, goal.reason)
  const maxRounds = goal.budget.maxRounds ?? DEFAULT_MAX_ROUNDS
  const rounds = Math.max(round, usage?.rounds ?? 0)
  const unpriced = usage?.costUnpriced === true
  const costLabel = usage === undefined ? undefined : unpriced && !usage.cost ? t('usage.unpriced') : formatCost(locale, currency, usage.cost ?? 0)
  const evidence = new Map((goal.evidence ?? []).map((e) => [e.criterionId, e]))
  const canPause = phase === 'running' || phase === 'waiting-input' || phase === 'waiting-external'
  const canResume = phase === 'paused' || phase === 'blocked' || phase === 'failed' || phase === 'budget-exhausted'
  const needsRaise = phase === 'budget-exhausted' && exhaustedNow(goal, usage, rounds)
  const busy = pending !== undefined
  // 已定价、没有费用上限：无人值守的推进只受轮次等维度限制，提示用户可以设上限。
  const noCostLimit = usage !== undefined && !unpriced && goal.budget.maxCost === undefined
  const budgetRows = DIMENSIONS.flatMap((d) => {
    const max = d.max(goal.budget)
    return max === undefined ? [] : [{ id: d.id, max, used: usage ? d.used(usage, rounds) : d.id === 'rounds' ? rounds : undefined }]
  })
  return (
    <section
      data-slot="goal-card"
      data-goal-id={goal.id}
      data-phase={phase}
      data-revision={goal.revision}
      aria-label={t('goal.card')}
      className="rounded-panel bg-background px-3 py-2 text-ui-body shadow-panel"
    >
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          data-action="toggle-goal"
          aria-expanded={expanded}
          // 可访问名称取按钮内容：目标（或"目标"标题）、阶段、轮次与费用。
          onClick={onToggle}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 rounded-sm text-start focus-ring"
        >
          <span className="flex min-w-0 flex-[1_1_8rem] items-center gap-2">
            <TargetIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            {expanded ? (
              <span className="shrink-0 font-medium">{t('goal.title')}</span>
            ) : (
              <span data-user-content data-slot="goal-summary" className="min-w-0 flex-1 truncate">
                {goal.objective}
              </span>
            )}
          </span>
          <span className="ms-auto flex shrink-0 items-center gap-2 text-ui-small text-muted-foreground tabular-nums">
            <GoalPhaseBadge phase={phase} />
            <span data-goal-rounds={rounds}>{t('goal.rounds', { used: rounds, max: maxRounds })}</span>
            {costLabel !== undefined && <span data-goal-cost={usage?.cost ?? 0}>{costLabel}</span>}
            <ChevronDownIcon aria-hidden className={cn('size-4 shrink-0 transition-transform motion-reduce:transition-none', expanded && 'rotate-180')} />
          </span>
        </button>
        {onClose && <CloseButton onClose={onClose} />}
      </div>
      {!expanded && reason && (
        <p data-slot="goal-reason" className={cn('mt-0.5 truncate ps-6 text-ui-small', phase === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>
          {reason.text}
        </p>
      )}
      {expanded && (
        <div data-slot="goal-details" className="mt-2 flex flex-col gap-3 ps-6">
          <ClampedText text={goal.objective} />
          {reason && (
            <p data-slot="goal-reason" className={cn('text-ui-small break-words', phase === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>
              {reason.text}
              {reason.detail !== undefined && (
                <>
                  {' · '}
                  <span data-user-content>{reason.detail}</span>
                </>
              )}
            </p>
          )}
          <div className="flex flex-col gap-1">
            <h3 className="text-ui-small text-muted-foreground">{t('goal.criteria')}</h3>
            <ul data-slot="goal-criteria" className="flex flex-col gap-1">
              {goal.criteria.map((criterion) => {
                const proof = evidence.get(criterion.id)
                return (
                  <li key={criterion.id} data-criterion={criterion.id} data-done={proof ? '' : undefined} className="flex min-w-0 items-start gap-2">
                    {proof ? (
                      <CircleCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                    ) : (
                      <CircleIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="sr-only">{proof ? t('goal.criterionDone') : t('goal.criterionOpen')}</span>
                    <div className="min-w-0 flex-1">
                      <p data-user-content className="break-words">
                        {criterion.text}
                      </p>
                      {proof && (
                        <p data-slot="goal-evidence" className="text-ui-small break-words text-muted-foreground">
                          <span className="sr-only">{t('goal.evidence')}: </span>
                          <span data-user-content>{proof.text}</span>
                        </p>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
            {goal.completedBy === 'user' && <p className="text-ui-small text-muted-foreground">{t('goal.completedByUser')}</p>}
          </div>
          {!terminal && budgetRows.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-ui-small text-muted-foreground">{t('goal.budget')}</h3>
              <ul data-slot="goal-budget" className="flex flex-col gap-2">
                {budgetRows.map((row) => (
                  <BudgetRow key={row.id} id={row.id} used={row.used} max={row.max} unpriced={unpriced} />
                ))}
              </ul>
              {noCostLimit && (
                <p data-slot="goal-no-cost-limit" className="text-ui-small text-muted-foreground">
                  {t('goal.noCostLimit')}
                </p>
              )}
            </div>
          )}
          {goal.cleanup && (
            <p data-slot="goal-cleanup" className="text-ui-small text-muted-foreground">
              {t('goal.cleanup', { runs: goal.cleanup.runsAborted, jobs: goal.cleanup.jobsKilled })}
              {goal.cleanup.failures.length > 0 && (
                <span className="text-destructive">
                  {' · '}
                  {t('goal.cleanupFailures', { count: goal.cleanup.failures.length })}
                </span>
              )}
            </p>
          )}
          {!terminal && (
            <div className="flex flex-col gap-1">
              <div role="group" aria-label={t('goal.card')} className="flex flex-wrap gap-1.5">
                {canPause && (
                  <Button size="sm" variant="outline" data-action="pause-goal" disabled={busy} onClick={() => void act('pause')}>
                    {t('goal.action.pause')}
                  </Button>
                )}
                {canResume && (
                  <Button size="sm" variant="outline" data-action="resume-goal" disabled={busy || needsRaise} onClick={() => void act('resume')}>
                    {t('goal.action.resume')}
                  </Button>
                )}
                <Button size="sm" variant="outline" data-action="edit-goal" disabled={busy} onClick={() => setDialog({ kind: 'edit', opened: Date.now() })}>
                  {t('goal.action.edit')}
                </Button>
                <Button size="sm" variant="outline" data-action="complete-goal" disabled={busy} onClick={() => void act('complete')}>
                  {t('goal.action.complete')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  data-action="cancel-goal"
                  className="text-destructive"
                  disabled={busy}
                  onClick={() => setDialog({ kind: 'cancel', opened: Date.now() })}
                >
                  {t('goal.action.cancel')}
                </Button>
              </div>
              {needsRaise && <p className="text-ui-small text-muted-foreground">{t('goal.raiseToResume')}</p>}
            </div>
          )}
        </div>
      )}
      {dialog?.kind === 'edit' && <GoalEditDialog key={dialog.opened} goal={goal} open onClose={() => setDialog(null)} act={act} />}
      <GoalCancelDialog open={dialog?.kind === 'cancel'} onClose={() => setDialog(null)} act={act} pending={pending === 'cancel'} />
    </section>
  )
}

function EmptyGoal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  return (
    <section data-slot="goal-card" data-empty aria-label={t('goal.card')} className="rounded-panel bg-background px-3 py-2 text-ui-body shadow-panel">
      <div className="flex min-w-0 items-start gap-2">
        <TargetIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{t('goal.empty.title')}</p>
          <p className="text-ui-small text-muted-foreground">{t('goal.empty.hint')}</p>
        </div>
        <CloseButton onClose={onClose} />
      </div>
    </section>
  )
}

/**
 * dock 的 Goal 卡：未终结的 Goal 一直显示；已终结的 Goal 在下一个 Run 开始前显示（完成后的证据、取消的清理结果）。/goal 打开时没有 Goal
 * 也显示空状态，直到下一个 Run 开始或关闭。收起时一行（目标、阶段、轮次、费用与原因），展开后为全文、成功条件与证据、预算条与操作。
 */
export function GoalCard({ sessionId }: DockCardProps) {
  const store = useGoalStoreApi()
  const entries = useChat((s) => s.conversations[sessionId]?.entries ?? NO_ENTRIES)
  const entry = latestGoalEntry(entries)
  const goal = entry?.payload
  const expanded = useGoals((s) => s.expanded[sessionId] ?? false)
  const opened = useGoals((s) => s.opened[sessionId])
  const dismissed = useGoals((s) => s.dismissed[sessionId])
  const pending = useGoals((s) => s.pending[sessionId])
  const loaded = useGoals((s) => s.usage[sessionId])
  // 影响用量的条目到达时重新读取已用量（Sidecar 每次从全部条目派生）；同一帧内到达的合并为一次。没有 Goal 时不读取。
  const hasGoal = goal !== undefined
  const changes = React.useMemo(() => usageChanges(entries), [entries])
  React.useEffect(() => {
    if (!hasGoal) return
    const frame = requestAnimationFrame(() => void store.getState().load(sessionId))
    return () => cancelAnimationFrame(frame)
  }, [store, sessionId, hasGoal, changes])
  const lastSeq = entries.at(-1)?.seq ?? 0
  const runAfter = (seq: number) => lastRunStartSeq(entries) > seq
  const pinned = opened !== undefined && !runAfter(opened)
  const close = () => store.getState().close(sessionId, lastSeq)
  if (!goal) {
    if (!pinned) return null
    return <EmptyGoal onClose={close} />
  }
  const terminal = isTerminal(goal.phase)
  if (terminal) {
    const hiddenByRun = runAfter(entry!.seq) && !pinned
    const hiddenByClose = dismissed !== undefined && dismissed >= entry!.seq && !pinned
    if (hiddenByRun || hiddenByClose) return null
  }
  const usage = loaded?.goalId === goal.id ? loaded.usage : undefined
  return (
    <GoalBody
      key={goal.id}
      sessionId={sessionId}
      goal={goal}
      round={goalRound(entries, goal.id)}
      usage={usage}
      expanded={expanded}
      pending={pending}
      onToggle={() => store.getState().setExpanded(sessionId, !expanded)}
      onClose={terminal ? close : undefined}
    />
  )
}
