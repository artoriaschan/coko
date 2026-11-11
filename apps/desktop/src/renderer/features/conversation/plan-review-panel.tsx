import { effectiveEntries } from '@coko/agent/entries'
import {
  planMarkdownProblem,
  planTitle,
  type AnswerApprovalRequest,
  type ApprovalRequestPayload,
  type PermissionMode,
  type SessionEntry,
  type StandardPermissionMode,
} from '@coko/protocol'
import { Button, cn, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Textarea } from '@coko/ui'
import { IconChevronDown, IconLayoutSidebarRightExpand } from '@tabler/icons-react'
import * as React from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { Theme } from '../../app/appearance-store.ts'
import { useI18n } from '../../app/i18n.tsx'
import { Markdown } from './markdown.tsx'

// Plan Mode 的界面状态（ADR 0005）：计划修订由 plan 条目派生；审阅中的编辑草稿在 renderer 内存（不入记录），右栏编辑、审阅卡批准共用。

export type PlanPayload = Extract<SessionEntry, { kind: 'plan' }>['payload']
export interface PlanRevision extends PlanPayload {
  seq: number
}

/** 有效条目（回退区间除外）中的计划：按 planId 分组，组内按条目顺序；组按首次出现的顺序。 */
export function planHistory(entries: readonly SessionEntry[]): Map<string, PlanRevision[]> {
  const plans = new Map<string, PlanRevision[]>()
  for (const entry of effectiveEntries(entries)) {
    if (entry.kind !== 'plan') continue
    const list = plans.get(entry.payload.planId) ?? []
    list.push({ ...entry.payload, seq: entry.seq })
    plans.set(entry.payload.planId, list)
  }
  return plans
}

/** 批准后恢复的模式：当前在 plan 时为进入前的模式（没有记录时 default），否则为当前模式。 */
export function restoredMode(entries: readonly SessionEntry[]): PermissionMode {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!
    if (entry.kind !== 'permission_mode') continue
    return entry.payload.mode === 'plan' ? (entry.payload.prior ?? 'default') : entry.payload.mode
  }
  return 'default'
}

const draftKey = (sessionId: string, planId: string, revision: number) => `${sessionId}:${planId}:${revision}`

/** 审阅中的编辑草稿（按 Session、planId 与 revision）。 */
export const planDraftStore = createStore<{ drafts: Record<string, string> }>()(() => ({ drafts: {} }))

export function setPlanDraft(sessionId: string, planId: string, revision: number, text: string | undefined) {
  planDraftStore.setState((s) => {
    const drafts = { ...s.drafts }
    if (text === undefined) delete drafts[draftKey(sessionId, planId, revision)]
    else drafts[draftKey(sessionId, planId, revision)] = text
    return { drafts }
  })
}

export function usePlanDraft(sessionId: string | null, planId: string | undefined, revision: number | undefined): string | undefined {
  return useStore(planDraftStore, (s) => (sessionId && planId && revision ? s.drafts[draftKey(sessionId, planId, revision)] : undefined))
}

/** 右栏中没有主题入口：按根元素的 dark 类（应用设置主题的地方）跟随。 */
export function useDocumentTheme(): Theme {
  return React.useSyncExternalStore(
    (onChange) => {
      const observer = new MutationObserver(onChange)
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
      return () => observer.disconnect()
    },
    () => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'),
  )
}

/** 计划正文（静态 Markdown）。 */
export function PlanMarkdown({ text, className }: { text: string; className?: string }) {
  const theme = useDocumentTheme()
  return (
    <div data-user-content data-slot="plan-markdown" className={cn('min-w-0 break-words', className)}>
      <Markdown text={text} streaming={false} theme={theme} />
    </div>
  )
}

/** 模式的显示名（plan 另在 plan 领域）。 */
export function useModeLabel(): (mode: PermissionMode) => string {
  const { t } = useI18n()
  return (mode) => (mode === 'plan' ? t('plan.mode') : t(`permissions.modes.${mode as StandardPermissionMode}`))
}

/** 新提交的计划只自动打开右栏一次（按请求）。 */
const autoOpened = new Set<string>()

export interface PlanReviewPanelProps {
  sessionId: string
  request: ApprovalRequestPayload
  entries: readonly SessionEntry[]
  answer: (answer: AnswerApprovalRequest) => Promise<boolean>
  /** 打开右栏的 Plan tab（右栏关闭时先打开）。 */
  onOpenPanel?: (() => void) | undefined
  autoFocus?: boolean
  className?: string
}

/**
 * 计划审阅接管输入区：主按钮"批准并执行"（标出将恢复的模式）、下拉"批准并允许编辑"、"继续规划"（反馈）与"在右栏查看"。
 * 右栏中的编辑随批准一起提交（editedPlan）。新计划出现时自动打开右栏一次。
 */
export function PlanReviewPanel({ sessionId, request, entries, answer, onOpenPanel, autoFocus, className }: PlanReviewPanelProps) {
  const { t } = useI18n()
  const modeLabel = useModeLabel()
  const planId = request.planId
  const revision = request.revision
  const proposed = React.useMemo(
    () =>
      planHistory(entries)
        .get(planId ?? '')
        ?.find((p) => p.revision === revision && p.status === 'proposed'),
    [entries, planId, revision],
  )
  const draft = usePlanDraft(sessionId, planId, revision)
  const edited = draft !== undefined && proposed !== undefined && draft !== proposed.markdown
  const invalid = edited && planMarkdownProblem(draft) !== undefined
  const restores = restoredMode(entries)
  // 批准时只能选比进入前更窄的模式（不借批准放宽设置）：只有进入前为 full-access 时才给出 accept-edits。
  const narrower = restores === 'full-access'
  const [answered, setAnswered] = React.useState(false)
  const [feedbackOpen, setFeedbackOpen] = React.useState(false)
  const [feedback, setFeedback] = React.useState('')
  const root = React.useRef<HTMLElement>(null)

  React.useEffect(() => {
    if (autoFocus) root.current?.focus()
  }, [])
  React.useEffect(() => {
    if (autoOpened.has(request.requestId) || !onOpenPanel) return
    autoOpened.add(request.requestId)
    onOpenPanel()
  }, [request.requestId, onOpenPanel])

  const send = async (body: AnswerApprovalRequest) => {
    if (answered) return
    setAnswered(true)
    const ok = await answer(body)
    if (!ok) setAnswered(false)
    else if (planId && revision) setPlanDraft(sessionId, planId, revision, undefined)
  }
  const approve = (mode?: 'accept-edits') => void send({ decision: 'allow', ...(edited && !invalid ? { editedPlan: draft } : {}), ...(mode ? { mode } : {}) })
  const keepPlanning = () => {
    const text = feedback.trim()
    if (text === '') return
    void send({ decision: 'deny', feedback: text })
  }

  return (
    <section
      ref={root}
      tabIndex={-1}
      data-slot="plan-review"
      data-plan-id={planId}
      data-revision={revision}
      aria-busy={answered || undefined}
      aria-label={t('plan.review.title')}
      className={cn('flex flex-col overflow-hidden rounded-panel bg-background shadow-soft outline-none', className)}
    >
      <p role="status" className="flex items-center gap-2 px-4 pt-3 text-ui-small text-muted-foreground">
        <span aria-hidden className="size-2 shrink-0 rounded-round bg-link" />
        {t('plan.review.title')}
        <span>{t('plan.revision', { n: String(revision ?? 1) })}</span>
        {edited && (
          <span data-slot="plan-edited" className="text-link">
            {t('plan.edited')}
          </span>
        )}
      </p>
      <div className="mx-2 mt-1 flex max-h-60 min-w-0 flex-col gap-2 overflow-y-auto rounded-xl px-2 py-2">
        <p data-user-content className="text-ui-body-lg font-medium">
          {request.subject || planTitle(proposed?.markdown ?? '')}
        </p>
        {proposed && <PlanMarkdown text={edited ? draft : proposed.markdown} className="text-ui-body" />}
      </div>
      {feedbackOpen && (
        <div className="flex flex-col gap-2 px-4 pt-2">
          <Textarea
            autoFocus
            aria-label={t('plan.review.feedbackLabel')}
            placeholder={t('plan.review.feedbackPlaceholder')}
            value={feedback}
            disabled={answered}
            onChange={(event) => setFeedback(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                setFeedbackOpen(false)
              } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                keepPlanning()
              }
            }}
          />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-3">
        {onOpenPanel && (
          <Button type="button" variant="ghost" size="sm" data-action="open-plan" onClick={onOpenPanel}>
            <IconLayoutSidebarRightExpand aria-hidden />
            {t('plan.review.openPanel')}
          </Button>
        )}
        {feedbackOpen ? (
          <>
            <Button type="button" variant="ghost" size="sm" disabled={answered} onClick={() => setFeedbackOpen(false)}>
              {t('plan.review.cancel')}
            </Button>
            <Button type="button" variant="outline" size="sm" data-action="send-feedback" disabled={answered || feedback.trim() === ''} onClick={keepPlanning}>
              {t('plan.review.sendFeedback')}
            </Button>
          </>
        ) : (
          <Button type="button" variant="outline" size="sm" data-action="keep-planning" disabled={answered} onClick={() => setFeedbackOpen(true)}>
            {t('plan.review.continue')}
          </Button>
        )}
        <div className="flex items-center">
          <Button
            type="button"
            size="sm"
            data-action="approve"
            data-restores={restores}
            disabled={answered || invalid}
            className={narrower ? 'rounded-e-none' : undefined}
            title={t('plan.review.restores', { mode: modeLabel(restores) })}
            onClick={() => approve()}
          >
            {t('plan.review.approve')}
            <span className="text-ui-small opacity-80">· {modeLabel(restores)}</span>
          </Button>
          {/* 非模态：批准后按钮即禁用，模态菜单关闭时的焦点归还与对其余节点的隐藏不再适用。 */}
          {narrower && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  data-action="approve-more"
                  disabled={answered || invalid}
                  aria-label={t('plan.review.more')}
                  className="rounded-s-none border-s-hairline border-primary-foreground/30"
                >
                  <IconChevronDown aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="end">
                <DropdownMenuItem data-action="approve-accept-edits" onSelect={() => approve('accept-edits')}>
                  {t('plan.review.approveAcceptEdits')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      {invalid && (
        <p role="alert" className="px-4 pb-3 text-ui-small text-destructive">
          {t('plan.invalid')}
        </p>
      )}
    </section>
  )
}
