import { CronError, ScheduleRuleError, upcomingOccurrences } from '@coko/agent/entries'
import type { MessageKey } from '@coko/i18n'
import { SCHEDULE_PROMPT_MAX, SCHEDULE_TITLE_MAX, type Schedule, type ScheduleRule, type SessionEntry } from '@coko/protocol'
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Textarea,
  toast,
  ToggleGroup,
  ToggleGroupItem,
} from '@coko/ui'
import { ChevronDownIcon, LoaderCircleIcon, PauseIcon, PencilIcon, PlayIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import * as React from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { useOptionalChatStoreApi } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { IconButton } from '../../app/icon-button.tsx'
import { ApiError } from '../../client/api.ts'
import type { ChatState } from '../../stores/chat-store.ts'
import {
  describeScheduleRule,
  formatScheduleTime,
  lastFireText,
  localTimeZone,
  nextRunText,
  ScheduleStatusDot,
  useSchedulesStoreApi,
  useSessionSchedules,
} from '../conversation/schedules-button.tsx'
import type { RightPanelTabProps } from './tabs.ts'

// 右栏 Schedules tab（docs/subsystems/schedules.md#界面）：会话的定时任务列表（标题、规则的本地化描述、下次时间与时区、状态、最近结果）、
// 新建与编辑（一次 / 间隔 / cron，cron 实时显示接下来 3 次）、暂停 / 恢复 / 删除（确认）与选中项的投递历史（schedule_fire 条目）。
// 表单、行操作与删除确认也供设置 → 定时任务使用。

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

// ---- 表单 ----

type FormKind = 'at' | 'every' | 'cron'

interface RuleDraft {
  kind: FormKind
  /** datetime-local 的值（本机时区，到分钟）。 */
  at: string
  everyMinutes: string
  expression: string
  timeZone: string
}

const pad = (n: number) => String(n).padStart(2, '0')
/** UTC 毫秒 → datetime-local 的值（本机时区）。 */
function toLocalInput(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function initialDraft(schedule: Schedule | undefined, now: number): RuleDraft {
  const hourLater = Math.ceil((now + 3_600_000) / 3_600_000) * 3_600_000
  const base: RuleDraft = { kind: 'cron', at: toLocalInput(hourLater), everyMinutes: '60', expression: '0 9 * * *', timeZone: localTimeZone() }
  const rule = schedule?.rule
  if (!rule) return base
  switch (rule.kind) {
    case 'cron':
      return { ...base, kind: 'cron', expression: rule.expression, timeZone: rule.timeZone }
    case 'every':
      return { ...base, kind: 'every', everyMinutes: String(rule.seconds / 60) }
    case 'at': {
      const at = Date.parse(rule.at)
      return { ...base, kind: 'at', at: Number.isFinite(at) ? toLocalInput(at) : base.at }
    }
    case 'after':
      // 表单没有"若干秒后"：以下次时间（或现在 + 1 小时）作为一次性时刻。
      return { ...base, kind: 'at', at: toLocalInput(schedule.nextAt ?? hourLater) }
  }
}

type RuleResult = { rule: ScheduleRule; upcoming: number[] } | { error: MessageKey }

/** 表单的规则与预览；不合要求时为本地化的错误键。校验与预览与 Sidecar 共用 @coko/agent/entries 的实现。 */
function buildRule(draft: RuleDraft, now: number): RuleResult {
  let rule: ScheduleRule
  if (draft.kind === 'at') {
    if (draft.at === '') return { error: 'schedules.errors.atRequired' }
    const at = new Date(draft.at).getTime()
    if (!Number.isFinite(at)) return { error: 'schedules.errors.atRequired' }
    if (at <= now) return { error: 'schedules.errors.atPast' }
    rule = { kind: 'at', at: new Date(at).toISOString() }
  } else if (draft.kind === 'every') {
    const minutes = draft.everyMinutes.trim()
    if (!/^\d+$/.test(minutes)) return { error: 'schedules.errors.everyInvalid' }
    if (Number(minutes) < 1) return { error: 'schedules.errors.everyTooShort' }
    rule = { kind: 'every', seconds: Number(minutes) * 60 }
  } else {
    rule = { kind: 'cron', expression: draft.expression.trim(), timeZone: draft.timeZone }
  }
  try {
    const upcoming = upcomingOccurrences(rule, now, 3)
    // 保存的形状与 Sidecar 归一后的一致（cron 的空白）。
    return { rule: rule.kind === 'cron' ? { ...rule, expression: rule.expression.split(/\s+/).join(' ') } : rule, upcoming }
  } catch (error) {
    if (error instanceof ScheduleRuleError || error instanceof CronError) {
      if (rule.kind === 'cron' && /time zone/i.test(error.message)) return { error: 'schedules.errors.timeZoneInvalid' }
      if (rule.kind === 'every') return { error: 'schedules.errors.everyTooShort' }
      if (rule.kind === 'at') return { error: 'schedules.errors.atPast' }
      return { error: 'schedules.errors.cronInvalid' }
    }
    throw error
  }
}

/** 时区下拉的选项：本机时区与 UTC 在前，其余为运行时支持的 IANA 名。 */
function timeZoneOptions(): string[] {
  const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? []
  const local = localTimeZone()
  return [...new Set([local, 'UTC', ...supported])]
}

function TimeZonePicker({ id, value, onChange, invalid }: { id: string; value: string; onChange: (zone: string) => void; invalid: boolean }) {
  const { t } = useI18n()
  const [open, setOpen] = React.useState(false)
  const zones = React.useMemo(() => (open ? timeZoneOptions() : []), [open])
  const local = localTimeZone()
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          data-slot="time-zone-picker"
          data-value={value}
          aria-invalid={invalid || undefined}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{value === local ? t('schedules.localTimeZone', { zone: value }) : value}</span>
          <ChevronDownIcon className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 w-(--radix-dropdown-menu-trigger-width)">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {zones.map((zone, index) => (
            <React.Fragment key={zone}>
              {index === 2 && <DropdownMenuSeparator />}
              <DropdownMenuRadioItem value={zone} data-zone={zone}>
                {zone === local ? t('schedules.localTimeZone', { zone }) : zone}
              </DropdownMenuRadioItem>
            </React.Fragment>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (message === undefined) return null
  return (
    <span id={id} role="alert" data-slot="field-error" className="text-ui-small text-destructive">
      {message}
    </span>
  )
}

export interface ScheduleFormProps {
  open: boolean
  onClose: () => void
  /** 新建时所在的会话。 */
  sessionId: string
  /** 编辑的任务；省略时新建。 */
  schedule?: Schedule | undefined
  /** 新建成功（选中它）。 */
  onCreated?: (schedule: Schedule) => void
}

/** 新建与编辑的对话框。字段错误在提交后（cron 与时区在输入时）行内显示；保存失败与 revision 冲突保留输入。 */
export function ScheduleFormDialog(props: ScheduleFormProps) {
  const { t } = useI18n()
  return (
    <Dialog open={props.open} onOpenChange={(next) => !next && props.onClose()}>
      <DialogContent closeLabel={t('schedules.close')} data-slot="schedule-form-dialog" className="max-w-[520px] gap-4 overflow-y-auto p-6">
        {props.open && <ScheduleForm {...props} />}
      </DialogContent>
    </Dialog>
  )
}

function ScheduleForm({ onClose, sessionId, schedule, onCreated }: ScheduleFormProps) {
  const { t, locale } = useI18n()
  const store = useSchedulesStoreApi()
  // 编辑中的任务以 store 中的最新快照为准（冲突读回后 revision 更新）。
  const latest = useStore(store, (s) => {
    if (!schedule) return undefined
    for (const list of Object.values(s.lists)) {
      const found = list.schedules.find((x) => x.id === schedule.id)
      if (found) return found
    }
    return schedule
  })
  // 只发送用户改过的字段：与表单打开时的值比较（冲突读回后，没改的字段保留另一处写入的值）。
  const [base] = React.useState(() => ({ title: schedule?.title ?? '', prompt: schedule?.prompt ?? '' }))
  const [title, setTitle] = React.useState(base.title)
  const [prompt, setPrompt] = React.useState(base.prompt)
  const [draft, setDraft] = React.useState(() => initialDraft(schedule, Date.now()))
  const [ruleTouched, setRuleTouched] = React.useState(schedule === undefined)
  const [attempted, setAttempted] = React.useState(false)
  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const ids = React.useId()
  const field = (name: string) => `${ids}-${name}`

  const patchRule = (patch: Partial<RuleDraft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setRuleTouched(true)
  }
  const now = Date.now()
  const result = buildRule(draft, now)
  const ruleError = 'error' in result ? result.error : undefined
  // cron 与时区在输入时校验；其他字段在提交后。
  const showRuleError = ruleError !== undefined && ruleTouched && (attempted || draft.kind === 'cron')
  const titleError = title.trim() === '' ? 'schedules.errors.titleRequired' : undefined
  const promptError = prompt.trim() === '' ? 'schedules.errors.promptRequired' : undefined

  const submit = async () => {
    setAttempted(true)
    setSubmitError(null)
    if (titleError || promptError || (ruleTouched && ruleError)) return
    const rule = 'rule' in result ? result.rule : undefined
    setSubmitting(true)
    try {
      if (!latest) {
        const created = await store.getState().create(sessionId, { title: title.trim(), prompt, rule: rule! })
        onCreated?.(created)
      } else {
        const patch = {
          ...(title.trim() !== base.title ? { title: title.trim() } : {}),
          ...(prompt !== base.prompt ? { prompt } : {}),
          // 改了规则的已结束任务（例如一次性任务改到新的时刻）重新启用。
          ...(ruleTouched && rule ? { rule, ...(latest.status === 'inactive' ? { status: 'active' as const } : {}) } : {}),
        }
        const saved = await store.getState().update(latest.id, patch)
        if (saved.status === 'conflict') {
          setSubmitError(t('schedules.errors.conflict'))
          return
        }
      }
      toast.success(t('schedules.saved'))
      onClose()
    } catch (error) {
      const limit = error instanceof ApiError && typeof error.details?.limit === 'number' ? error.details.limit : undefined
      setSubmitError(limit !== undefined ? t('schedules.errors.tooMany', { limit }) : t('schedules.errors.saveFailed', { message: errorMessage(error) }))
    } finally {
      setSubmitting(false)
    }
  }

  const ruleErrorId = field('rule-error')
  const ruleInvalid = showRuleError || undefined
  return (
    <>
      <div className="flex flex-col gap-1 pe-8">
        <DialogTitle>{t(schedule ? 'schedules.editTitle' : 'schedules.newTitle')}</DialogTitle>
        <DialogDescription>{t('schedules.formDescription')}</DialogDescription>
      </div>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (!submitting) void submit()
        }}
      >
        <label className="flex flex-col gap-1.5 text-ui-body">
          <span className="font-medium">{t('schedules.fields.title')}</span>
          <Input
            name="schedule-title"
            value={title}
            maxLength={SCHEDULE_TITLE_MAX}
            autoFocus
            autoComplete="off"
            aria-invalid={(attempted && titleError !== undefined) || undefined}
            aria-describedby={attempted && titleError ? field('title-error') : undefined}
            onChange={(event) => setTitle(event.target.value)}
          />
          <FieldError id={field('title-error')} message={attempted && titleError ? t(titleError) : undefined} />
        </label>
        <label className="flex flex-col gap-1.5 text-ui-body">
          <span className="font-medium">{t('schedules.fields.prompt')}</span>
          <Textarea
            name="schedule-prompt"
            value={prompt}
            maxLength={SCHEDULE_PROMPT_MAX}
            rows={3}
            aria-invalid={(attempted && promptError !== undefined) || undefined}
            aria-describedby={attempted && promptError ? field('prompt-error') : undefined}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <FieldError id={field('prompt-error')} message={attempted && promptError ? t(promptError) : undefined} />
        </label>
        <div className="flex flex-col gap-1.5 text-ui-body">
          <span id={field('kind')} className="font-medium">
            {t('schedules.fields.kind')}
          </span>
          <ToggleGroup
            type="single"
            aria-labelledby={field('kind')}
            value={draft.kind}
            onValueChange={(value) => value && patchRule({ kind: value as FormKind })}
          >
            {(['at', 'every', 'cron'] as const).map((kind) => (
              <ToggleGroupItem key={kind} value={kind} data-kind={kind}>
                {t(`schedules.kinds.${kind}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        {draft.kind === 'at' && (
          <label className="flex flex-col gap-1.5 text-ui-body">
            <span className="font-medium">{t('schedules.fields.at')}</span>
            <Input
              type="datetime-local"
              name="schedule-at"
              value={draft.at}
              aria-invalid={ruleInvalid}
              aria-describedby={showRuleError ? ruleErrorId : undefined}
              onChange={(event) => patchRule({ at: event.target.value })}
            />
          </label>
        )}
        {draft.kind === 'every' && (
          <label className="flex flex-col gap-1.5 text-ui-body">
            <span className="font-medium">{t('schedules.fields.every')}</span>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              name="schedule-every"
              value={draft.everyMinutes}
              aria-invalid={ruleInvalid}
              aria-describedby={showRuleError ? ruleErrorId : undefined}
              onChange={(event) => patchRule({ everyMinutes: event.target.value })}
            />
          </label>
        )}
        {draft.kind === 'cron' && (
          <div className="flex flex-col gap-4 sm:flex-row">
            <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-ui-body">
              <span className="font-medium">{t('schedules.fields.cron')}</span>
              <Input
                name="schedule-cron"
                value={draft.expression}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                aria-invalid={(showRuleError && ruleError !== 'schedules.errors.timeZoneInvalid') || undefined}
                aria-describedby={`${field('cron-hint')}${showRuleError ? ` ${ruleErrorId}` : ''}`}
                onChange={(event) => patchRule({ expression: event.target.value })}
              />
              <span id={field('cron-hint')} className="text-ui-small text-muted-foreground">
                {t('schedules.cronHint')}
              </span>
            </label>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-ui-body">
              <label htmlFor={field('zone')} className="font-medium">
                {t('schedules.fields.timeZone')}
              </label>
              <TimeZonePicker
                id={field('zone')}
                value={draft.timeZone}
                invalid={showRuleError && ruleError === 'schedules.errors.timeZoneInvalid'}
                onChange={(timeZone) => patchRule({ timeZone })}
              />
            </div>
          </div>
        )}
        <FieldError id={ruleErrorId} message={showRuleError ? t(ruleError!) : undefined} />
        {draft.kind !== 'at' && 'upcoming' in result && (
          <div className="flex flex-col gap-1 text-ui-body">
            <span id={field('upcoming')} className="text-ui-small text-muted-foreground">
              {t('schedules.upcoming')}
            </span>
            <ol aria-labelledby={field('upcoming')} data-slot="schedule-upcoming" className="flex flex-col gap-0.5 font-mono text-ui-small">
              {result.upcoming.map((at) => (
                <li key={at} data-at={at}>
                  {formatScheduleTime(locale, at, draft.kind === 'cron' ? draft.timeZone : undefined)}
                </li>
              ))}
            </ol>
          </div>
        )}
        {submitError !== null && (
          <p role="alert" data-slot="schedule-form-error" className="text-ui-body text-destructive">
            {submitError}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('schedules.cancel')}
          </Button>
          <Button type="submit" data-action="save-schedule" disabled={submitting}>
            {submitting && <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />}
            {submitting ? t('schedules.saving') : t(schedule ? 'schedules.save' : 'schedules.create')}
          </Button>
        </div>
      </form>
    </>
  )
}

// ---- 删除确认与行操作 ----

/** 删除确认。提交状态属于这一个任务：调用方以 key={schedule?.id} 让换一个任务时重新挂载。 */
export function DeleteScheduleDialog({ schedule, onClose }: { schedule: Schedule | null; onClose: () => void }) {
  const { t } = useI18n()
  const store = useSchedulesStoreApi()
  const [submitting, setSubmitting] = React.useState(false)
  const confirm = async () => {
    if (!schedule) return
    setSubmitting(true)
    try {
      await store.getState().remove(schedule.id)
      toast.success(t('schedules.deleted'))
      onClose()
    } catch (error) {
      toast.error(t('schedules.errors.actionFailed', { message: errorMessage(error) }))
    } finally {
      setSubmitting(false)
    }
  }
  return (
    <Dialog open={schedule !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('schedules.close')} data-slot="delete-schedule-dialog" className="max-w-[440px] gap-4 p-6">
        {schedule && (
          <>
            <div className="flex flex-col gap-1 pe-8">
              <DialogTitle>{t('schedules.deleteTitle', { title: schedule.title })}</DialogTitle>
              <DialogDescription>{t('schedules.deleteDescription')}</DialogDescription>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                {t('schedules.cancel')}
              </Button>
              <Button variant="destructive" data-action="confirm-delete-schedule" disabled={submitting} onClick={() => void confirm()}>
                {submitting && <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />}
                {submitting ? t('schedules.deleting') : t('schedules.confirmDelete')}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** 暂停 / 恢复（已结束的任务经编辑重新启用）、可选的编辑，以及删除（由调用方打开确认）。revision 冲突时提示并读回。 */
export function ScheduleRowActions({ schedule, onEdit, onDelete }: { schedule: Schedule; onEdit?: () => void; onDelete: () => void }) {
  const { t } = useI18n()
  const store = useSchedulesStoreApi()
  const [busy, setBusy] = React.useState(false)
  const setStatus = async (status: 'active' | 'paused') => {
    setBusy(true)
    try {
      const result = await store.getState().update(schedule.id, { status })
      if (result.status === 'conflict') toast.warning(t('schedules.errors.conflict'))
    } catch (error) {
      toast.error(t('schedules.errors.actionFailed', { message: errorMessage(error) }))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex shrink-0 items-center">
      {schedule.status === 'active' && (
        <IconButton
          label={t('schedules.pause', { title: schedule.title })}
          size="icon-sm"
          data-action="pause-schedule"
          disabled={busy}
          onClick={() => void setStatus('paused')}
        >
          <PauseIcon />
        </IconButton>
      )}
      {schedule.status === 'paused' && (
        <IconButton
          label={t('schedules.resume', { title: schedule.title })}
          size="icon-sm"
          data-action="resume-schedule"
          disabled={busy}
          onClick={() => void setStatus('active')}
        >
          <PlayIcon />
        </IconButton>
      )}
      {onEdit && (
        <IconButton label={t('schedules.edit', { title: schedule.title })} size="icon-sm" data-action="edit-schedule" onClick={onEdit}>
          <PencilIcon />
        </IconButton>
      )}
      <IconButton label={t('schedules.delete', { title: schedule.title })} size="icon-sm" data-action="delete-schedule" onClick={onDelete}>
        <Trash2Icon />
      </IconButton>
    </div>
  )
}

/** 列表项的内容：标题、状态、规则、下次时间与时区、最近结果。 */
export function ScheduleSummary({ schedule }: { schedule: Schedule }) {
  const { t, locale } = useI18n()
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="flex min-w-0 items-center gap-1.5">
        <ScheduleStatusDot status={schedule.status} />
        <span data-user-content className="truncate text-ui-body font-medium" title={schedule.title}>
          {schedule.title}
        </span>
        <span className="shrink-0 text-ui-small text-muted-foreground">{t(`schedules.status.${schedule.status}`)}</span>
      </span>
      <span data-slot="schedule-rule" className="truncate text-ui-small text-muted-foreground">
        {describeScheduleRule(t, locale, schedule.rule)}
      </span>
      <span data-slot="schedule-next" className="text-ui-small text-muted-foreground">
        {nextRunText(t, locale, schedule)}
      </span>
      <span
        data-slot="schedule-last"
        data-last-status={schedule.lastFire?.status}
        className={cn('text-ui-small text-muted-foreground', schedule.lastFire?.status === 'skipped' && 'text-warning-text')}
      >
        {lastFireText(t, schedule)}
      </span>
    </span>
  )
}

// ---- 投递历史 ----

const EMPTY: SessionEntry[] = []
const noChat = createStore<Pick<ChatState, 'conversations'>>()(() => ({ conversations: {} }))

function ScheduleHistory({ sessionId, schedule }: { sessionId: string; schedule: Schedule }) {
  const { t, locale } = useI18n()
  const chat = useOptionalChatStoreApi() ?? noChat
  const entries = useStore(chat, (s) => s.conversations[sessionId]?.entries ?? EMPTY)
  const fires = React.useMemo(
    () =>
      entries
        .filter((e): e is Extract<SessionEntry, { kind: 'schedule_fire' }> => e.kind === 'schedule_fire' && e.payload.scheduleId === schedule.id)
        .reverse(),
    [entries, schedule.id],
  )
  const headingId = React.useId()
  return (
    <section
      aria-labelledby={headingId}
      data-slot="schedule-history"
      data-schedule-id={schedule.id}
      className="flex min-h-0 flex-1 flex-col border-t-hairline border-border"
    >
      <h3 id={headingId} className="shrink-0 truncate px-3 pt-2 pb-1 text-ui-small font-medium text-muted-foreground">
        {t('schedules.historyOf', { title: schedule.title })}
      </h3>
      {fires.length === 0 ? (
        <p className="px-3 py-2 text-ui-body text-muted-foreground">{t('schedules.historyEmpty')}</p>
      ) : (
        <ol data-scroll-stable className="flex min-h-0 flex-col gap-1 overflow-y-auto px-3 pb-2">
          {fires.map((entry) => {
            const fire = entry.payload
            const skipped = fire.status === 'skipped'
            return (
              <li key={entry.seq} data-slot="schedule-history-item" data-status={fire.status} className="flex min-w-0 flex-col text-ui-small">
                <span className={skipped ? 'text-warning-text' : 'text-foreground'}>
                  {t(skipped ? 'schedules.fireRow.skipped' : 'schedules.fireRow.started')}
                  {skipped && ` · ${t(`schedules.skipReasons.${fire.reason ?? 'start-failed'}`)}`}
                </span>
                <span className="text-muted-foreground">
                  {[
                    t('schedules.occurrence', { time: formatScheduleTime(locale, fire.occurrence) }),
                    fire.missed === undefined ? undefined : t('schedules.missed', { count: fire.missed }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

// ---- tab ----

/** 选中项按会话保存在内存中（右栏在会话之间复用）。 */
const selection = createStore<Record<string, string>>()(() => ({}))

export function SchedulesTab({ sessionId }: RightPanelTabProps) {
  const { t } = useI18n()
  const store = useSchedulesStoreApi()
  const list = useSessionSchedules(sessionId)
  const selectedId = useStore(selection, (s) => (sessionId === null ? undefined : s[sessionId]))
  const [form, setForm] = React.useState<{ schedule?: Schedule } | null>(null)
  const [deleting, setDeleting] = React.useState<Schedule | null>(null)
  if (sessionId === null)
    return <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-ui-body text-muted-foreground">{t('schedules.noSession')}</div>
  const select = (id: string) => selection.setState({ [sessionId]: id })
  const schedules = list?.schedules ?? []
  const current = schedules.find((s) => s.id === selectedId) ?? schedules.at(-1)

  let body: React.ReactNode
  if (!list || (list.status === 'loading' && schedules.length === 0))
    body = (
      <div aria-label={t('schedules.loading')} aria-busy className="flex flex-col gap-1 px-2">
        {[0, 1].map((i) => (
          <div key={i} aria-hidden className="h-16 rounded-md bg-skeleton" />
        ))}
      </div>
    )
  else if (list.status === 'error' && schedules.length === 0)
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-ui-body text-muted-foreground">
        <p>{t('schedules.loadFailed')}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void store.getState().load(sessionId)}>
          {t('schedules.retry')}
        </Button>
      </div>
    )
  else if (schedules.length === 0)
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 p-6 text-center text-ui-body text-muted-foreground">
        <p>{t('schedules.empty')}</p>
        <p className="text-ui-small">{t('schedules.emptyHint')}</p>
      </div>
    )
  else
    body = (
      <>
        <ul aria-label={t('schedules.list')} data-scroll-stable className="flex max-h-[55%] shrink-0 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
          {schedules.map((schedule) => (
            <li
              key={schedule.id}
              data-schedule-id={schedule.id}
              data-status={schedule.status}
              aria-current={schedule === current || undefined}
              className="flex min-w-0 items-start gap-1 rounded-md px-1 py-1 aria-current:bg-accent [@media(hover:hover)]:hover:bg-accent"
            >
              <button
                type="button"
                data-action="select-schedule"
                className="flex min-w-0 flex-1 rounded-sm px-1 py-0.5 text-start focus-ring"
                aria-label={schedule.title}
                aria-describedby={`schedule-summary-${schedule.id}`}
                onClick={() => select(schedule.id)}
              >
                <span id={`schedule-summary-${schedule.id}`} className="flex min-w-0 flex-1">
                  <ScheduleSummary schedule={schedule} />
                </span>
              </button>
              <ScheduleRowActions schedule={schedule} onEdit={() => setForm({ schedule })} onDelete={() => setDeleting(schedule)} />
            </li>
          ))}
        </ul>
        {current && <ScheduleHistory key={current.id} sessionId={sessionId} schedule={current} />}
      </>
    )

  return (
    <div data-slot="schedules-tab" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-end px-2 pb-2">
        <Button type="button" variant="outline" size="sm" data-action="new-schedule" onClick={() => setForm({})}>
          <PlusIcon />
          {t('schedules.new')}
        </Button>
      </div>
      {body}
      <ScheduleFormDialog
        open={form !== null}
        onClose={() => setForm(null)}
        sessionId={sessionId}
        schedule={form?.schedule}
        onCreated={(created) => select(created.id)}
      />
      <DeleteScheduleDialog key={deleting?.id} schedule={deleting} onClose={() => setDeleting(null)} />
    </div>
  )
}
