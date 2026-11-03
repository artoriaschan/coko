import { planMarkdownProblem, planTitle } from '@coko/protocol'
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger, Textarea } from '@coko/ui'
import { ChevronDownIcon, PencilIcon, RotateCcwIcon } from 'lucide-react'
import * as React from 'react'
import { useChat } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { pendingApprovals } from '../../stores/chat-store.ts'
import { PlanMarkdown, planHistory, setPlanDraft, usePlanDraft } from '../conversation/plan-review-panel.tsx'
import type { RightPanelTabProps } from './tabs.ts'

const EMPTY: never[] = []

/**
 * 右栏 Plan tab：选中的修订（缺省为最新）的静态 Markdown、修订下拉与状态；审阅中的修订可编辑（mono Textarea），编辑随批准提交。
 */
export function PlanTab({ sessionId }: RightPanelTabProps) {
  const { t } = useI18n()
  const entries = useChat((s) => (sessionId === null ? EMPTY : (s.conversations[sessionId]?.entries ?? EMPTY)))
  const running = useChat((s) => (sessionId === null ? false : (s.conversations[sessionId]?.running ?? false)))
  const history = React.useMemo(() => planHistory(entries), [entries])
  // 修订列表：最新在前，每个 planId 每个 revision 取最后一条（状态最新）。
  const revisions = React.useMemo(
    () => [...history.values()].flatMap((list) => [...new Map(list.map((p) => [p.revision, p])).values()]).sort((a, b) => b.seq - a.seq),
    [history],
  )
  const pending = React.useMemo(() => (running ? pendingApprovals(entries).find((e) => e.payload.kind === 'plan') : undefined), [entries, running])
  const latestKey = revisions[0] ? `${revisions[0].planId}:${revisions[0].revision}` : null
  // 选择与当时的最新修订一起保存：新的修订出现后（latestKey 变化）选择失效，回到最新。渲染时派生，不用 effect 同步。
  const [choice, setChoice] = React.useState<{ latest: string | null; key: string } | null>(null)
  const selected = choice !== null && choice.latest === latestKey ? choice.key : null
  const setSelected = (key: string) => setChoice({ latest: latestKey, key })
  const current = revisions.find((p) => `${p.planId}:${p.revision}` === selected) ?? revisions[0]
  const reviewing = pending !== undefined && current !== undefined && pending.payload.planId === current.planId && pending.payload.revision === current.revision
  const draft = usePlanDraft(sessionId, current?.planId, current?.revision)
  const [editingRequested, setEditing] = React.useState(false)
  // 只有审阅中的修订可编辑：审阅结束后编辑框随之关闭。
  const editing = editingRequested && reviewing

  if (!current || sessionId === null) {
    return <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-ui-body text-muted-foreground">{t('plan.empty')}</div>
  }
  const text = reviewing && draft !== undefined ? draft : current.markdown
  const invalid = reviewing && draft !== undefined && planMarkdownProblem(draft) !== undefined
  return (
    <div
      data-slot="plan-tab"
      data-plan-id={current.planId}
      data-revision={current.revision}
      data-status={current.status}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 pb-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="toolbar" size="sm" data-action="plan-revisions" aria-label={t('plan.revisions')} className="min-w-0 shrink">
              <span className="truncate">{t('plan.revision', { n: String(current.revision) })}</span>
              <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-w-80">
            <DropdownMenuRadioGroup value={`${current.planId}:${current.revision}`} onValueChange={setSelected}>
              {revisions.map((p) => (
                <DropdownMenuRadioItem key={`${p.planId}:${p.revision}`} value={`${p.planId}:${p.revision}`} data-revision={p.revision}>
                  <span data-user-content className="min-w-0 truncate">
                    {t('plan.revision', { n: String(p.revision) })} · {planTitle(p.markdown)}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <span data-slot="plan-status" data-status={current.status} className="rounded-sm bg-accent px-1.5 py-0.5 text-ui-small text-muted-foreground">
          {t(`plan.status.${current.status}`)}
        </span>
        <span className="flex-1" />
        {reviewing && draft !== undefined && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-action="plan-reset"
            onClick={() => setPlanDraft(sessionId, current.planId, current.revision, undefined)}
          >
            <RotateCcwIcon />
            {t('plan.reset')}
          </Button>
        )}
        {reviewing && (
          <Button type="button" variant="outline" size="sm" data-action="plan-edit" aria-pressed={editing} onClick={() => setEditing((e) => !e)}>
            <PencilIcon />
            {editing ? t('plan.editDone') : t('plan.edit')}
          </Button>
        )}
      </div>
      {current.feedback !== undefined && (
        <p data-slot="plan-feedback" className="mx-4 mb-2 rounded-md bg-accent px-3 py-2 text-ui-body">
          <span className="text-muted-foreground">{t('plan.feedback')}：</span>
          <span data-user-content>{current.feedback}</span>
        </p>
      )}
      <div data-scroll-stable className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4">
        {editing && reviewing ? (
          <>
            <Textarea
              variant="mono"
              aria-label={t('plan.editLabel')}
              aria-invalid={invalid || undefined}
              className="min-h-80 flex-1"
              value={text}
              onChange={(event) => setPlanDraft(sessionId, current.planId, current.revision, event.target.value)}
            />
            {invalid && (
              <p role="alert" className="pt-2 text-ui-small text-destructive">
                {t('plan.invalid')}
              </p>
            )}
          </>
        ) : (
          <PlanMarkdown text={text} className="text-ui-body" />
        )}
      </div>
    </div>
  )
}
