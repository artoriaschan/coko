// 设置 → Hooks 分区（ADR 0013）：能力开关 hooks.enabled（只在全局）、全局配置的 JSON 编辑（保存前校验，诊断行内显示，revision 冲突时读回）、
// 当前会话目录的项目 Hook（完整命令、批准、已批准 / 待批准 / 已改动）与按事件分组的已加载清单。
import type { HookEvent, HooksConfig, HooksResponse, ProjectHookEntry, ResourceDiagnostic } from '@coko/protocol'
import { HOOK_EVENTS } from '@coko/protocol'
import { Button, Checkbox, cn, Textarea, toast } from '@coko/ui'
import * as React from 'react'
import { useStore } from 'zustand'
import { useChat, useActiveWorkspaceId } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { ApiError } from '../../client/api.ts'
import { createConfigClient } from '../../stores/config-store.ts'
import { hooksStore, type HooksTarget } from '../../stores/hooks-store.ts'
import { SettingsCard } from './settings-page.tsx'

const configClient = createConfigClient()
const format = (hooks: HooksConfig) => JSON.stringify(hooks, null, 2)

/** 已加载的一条 Hook（全局配置中的一条或已批准的项目 Hook）。 */
interface LoadedRow {
  key: string
  source: 'global' | 'project'
  matcher?: string
  command: string
}

function loadedByEvent(view: HooksResponse): [HookEvent, LoadedRow[]][] {
  const rows = new Map<string, LoadedRow[]>()
  const push = (event: string, row: LoadedRow) => rows.set(event, [...(rows.get(event) ?? []), row])
  for (const [event, groups] of Object.entries(view.global.hooks))
    groups.forEach((group, g) =>
      group.hooks.forEach((hook, h) =>
        push(event, { key: `global:${event}:${g}:${h}`, source: 'global', ...(group.matcher ? { matcher: group.matcher } : {}), command: hook.command }),
      ),
    )
  for (const entry of view.project?.entries ?? [])
    if (entry.approved)
      push(entry.event, { key: entry.hookId, source: 'project', ...(entry.matcher ? { matcher: entry.matcher } : {}), command: entry.command })
  return HOOK_EVENTS.flatMap((event) => (rows.has(event) ? [[event, rows.get(event)!] as [HookEvent, LoadedRow[]]] : []))
}

export function HooksSection() {
  const { t } = useI18n()
  const sessionId = useChat((s) => s.activeSessionId ?? undefined)
  const workspaceId = useActiveWorkspaceId()
  const target: HooksTarget | undefined = sessionId !== undefined ? { sessionId } : workspaceId !== undefined ? { workspaceId } : undefined
  const status = useStore(hooksStore, (s) => s.status)
  const view = useStore(hooksStore, (s) => s.view)

  // 只按会话与 Workspace 的 id 重读（target 每次渲染是新对象）。
  const load = React.useCallback(
    () => hooksStore.getState().load(sessionId !== undefined ? { sessionId } : workspaceId !== undefined ? { workspaceId } : undefined),
    [sessionId, workspaceId],
  )
  React.useEffect(() => void load(), [load])

  return (
    <section aria-labelledby="settings-hooks" className="flex flex-col gap-3" data-hooks-section>
      <div className="flex min-w-0 flex-col">
        <h2 id="settings-hooks" className="text-ui-body-lg font-medium">
          {t('hooks.title')}
        </h2>
        <p className="text-ui-small text-muted-foreground">{t('hooks.settings.description')}</p>
      </div>
      {status === 'error' && !view && (
        <div className="flex items-center gap-2" role="alert">
          <p className="text-ui-body text-muted-foreground">{t('hooks.settings.loadFailed')}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            {t('hooks.settings.retry')}
          </Button>
        </div>
      )}
      {view && (
        <>
          <SettingsCard>
            <EnabledToggle enabled={view.enabled} reload={load} />
          </SettingsCard>
          {!view.enabled && <p className="text-ui-small text-warning-text">{t('hooks.settings.disabled')}</p>}
          <GlobalEditor view={view} />
          <ProjectHooks view={view} workspaceId={workspaceId} hasTarget={target !== undefined} />
          <LoadedHooks view={view} />
        </>
      )}
    </section>
  )
}

/** hooks.enabled 只在全局设置生效：PUT /api/config 整体替换全局值（其他键原样带回）。 */
function EnabledToggle({ enabled, reload }: { enabled: boolean; reload: () => Promise<void> }) {
  const { t } = useI18n()
  const [busy, setBusy] = React.useState(false)
  const id = React.useId()
  return (
    <div className="flex items-start gap-3 px-4 py-3" data-capability="hooks.enabled">
      <Checkbox
        id={id}
        className="mt-0.5"
        data-capability-enabled={String(enabled)}
        checked={enabled}
        disabled={busy}
        onCheckedChange={async (checked) => {
          setBusy(true)
          try {
            await configClient.update((global) => ({ ...global, hooks: { ...global.hooks, enabled: checked === true } }))
            await reload()
          } catch {
            toast.error(t('hooks.settings.enabled.saveFailed'))
          } finally {
            setBusy(false)
          }
        }}
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={id} className="text-ui-body">
          {t('hooks.settings.enabled.label')}
        </label>
        <span className="text-ui-small text-muted-foreground">{t('hooks.settings.enabled.hint')}</span>
      </div>
    </div>
  )
}

function GlobalEditor({ view }: { view: HooksResponse }) {
  const { t } = useI18n()
  const id = React.useId()
  const saved = format(view.global.hooks)
  const [draft, setDraft] = React.useState(saved)
  const [base, setBase] = React.useState(view.global.revision)
  const [problem, setProblem] = React.useState<{ message: string; diagnostics: ResourceDiagnostic[] } | null>(null)
  const [saving, setSaving] = React.useState(false)
  // 读回的 revision 变化（保存成功、冲突读回或别处修改）时编辑区换成最新值：渲染期间按 revision 调整状态（不经 effect）。
  if (view.global.revision !== base) {
    setBase(view.global.revision)
    setDraft(saved)
  }
  const dirty = draft !== saved

  const save = async () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(draft)
    } catch (error) {
      return setProblem({
        message: t('hooks.settings.global.invalidJson', { message: error instanceof Error ? error.message : String(error) }),
        diagnostics: [],
      })
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      return setProblem({ message: t('hooks.settings.global.notObject'), diagnostics: [] })
    setSaving(true)
    try {
      await hooksStore.getState().save(parsed as HooksConfig)
      setProblem(null)
      toast.success(t('hooks.settings.global.saved'))
    } catch (error) {
      if (error instanceof ApiError && error.code === 'revision-conflict') {
        setProblem({ message: t('hooks.settings.global.conflict'), diagnostics: [] })
        setDraft(format(hooksStore.getState().view?.global.hooks ?? {}))
      } else if (error instanceof ApiError && error.status === 400) {
        const details = error.details as { diagnostics?: ResourceDiagnostic[] } | undefined
        setProblem({ message: t('hooks.settings.global.invalid'), diagnostics: details?.diagnostics ?? [] })
      } else {
        toast.error(t('hooks.settings.global.saveFailed'))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2" data-hooks-global data-revision={view.global.revision}>
      <div className="flex flex-col">
        <h3 className="text-ui-body font-medium">{t('hooks.settings.global.title')}</h3>
        <p className="text-ui-small text-muted-foreground">{t('hooks.settings.global.hint')}</p>
      </div>
      <label htmlFor={id} className="sr-only">
        {t('hooks.settings.global.editor')}
      </label>
      <Textarea
        id={id}
        name="hooks"
        variant="mono"
        rows={10}
        value={draft}
        spellCheck={false}
        aria-invalid={problem !== null && problem.message !== t('hooks.settings.global.conflict')}
        aria-describedby={problem ? `${id}-problem` : undefined}
        onChange={(e) => {
          setDraft(e.target.value)
          setProblem(null)
        }}
        className="min-h-48"
      />
      {problem && (
        <div id={`${id}-problem`} role="alert" data-hooks-problem className="flex flex-col gap-1">
          <p className="text-ui-small text-destructive">{problem.message}</p>
          {problem.diagnostics.length > 0 && <Diagnostics diagnostics={problem.diagnostics} />}
        </div>
      )}
      {view.global.diagnostics.length > 0 && <Diagnostics diagnostics={view.global.diagnostics} />}
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={!dirty || saving}
          onClick={() => {
            setDraft(saved)
            setProblem(null)
          }}
        >
          {t('hooks.settings.global.reset')}
        </Button>
        <Button size="sm" data-action="save-hooks" disabled={!dirty || saving} onClick={() => void save()}>
          {t('hooks.settings.global.save')}
        </Button>
      </div>
    </div>
  )
}

const projectStatus = (entry: ProjectHookEntry) => (entry.approved ? 'approved' : entry.changed ? 'changed' : 'pending')
const STATUS_TONE = { approved: 'text-success-text', pending: 'text-warning-text', changed: 'text-warning-text' } as const

function ProjectHooks({ view, workspaceId, hasTarget }: { view: HooksResponse; workspaceId: string | undefined; hasTarget: boolean }) {
  const { t } = useI18n()
  const [working, setWorking] = React.useState<string | null>(null)
  const project = view.project
  return (
    <div className="mt-2 flex flex-col gap-2" data-hooks-project>
      <div className="flex flex-col">
        <h3 className="text-ui-body font-medium">{t('hooks.settings.project.title')}</h3>
        <p className="text-ui-small text-muted-foreground">{t('hooks.settings.project.hint')}</p>
      </div>
      {!hasTarget && <p className="text-ui-small text-muted-foreground">{t('hooks.settings.project.noWorkspace')}</p>}
      {project && (
        <p data-user-content className="font-mono text-ui-small break-all text-muted-foreground">
          {project.path}
        </p>
      )}
      {project && project.entries.length === 0 && <p className="text-ui-body text-muted-foreground">{t('hooks.settings.project.none')}</p>}
      {project?.entries.map((entry) => {
        const state = projectStatus(entry)
        return (
          <SettingsCard key={entry.hookId} data-project-hook={entry.hookId} data-status={state} className="flex flex-col gap-1.5 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-ui-small">{entry.event}</span>
              <span data-hook-status className={cn('text-ui-small', STATUS_TONE[state])}>
                {t(`hooks.settings.project.status.${state}`)}
              </span>
              <span className="flex min-w-0 flex-1 flex-wrap gap-x-2 text-ui-small text-muted-foreground">
                {entry.matcher !== undefined && <span data-user-content>{t('hooks.settings.project.matcher', { matcher: entry.matcher })}</span>}
                {entry.if !== undefined && <span data-user-content>{t('hooks.settings.project.condition', { condition: entry.if })}</span>}
                {entry.timeout !== undefined && <span>{t('hooks.settings.project.timeout', { seconds: entry.timeout })}</span>}
              </span>
              {!entry.approved && workspaceId !== undefined && (
                <Button
                  size="sm"
                  data-action="approve-hook"
                  disabled={working !== null}
                  onClick={async () => {
                    setWorking(entry.hookId)
                    try {
                      await hooksStore.getState().approve(workspaceId, entry.digest)
                    } catch {
                      toast.error(t('hooks.settings.project.approveFailed'))
                    } finally {
                      setWorking(null)
                    }
                  }}
                >
                  {t('hooks.settings.project.approve')}
                </Button>
              )}
            </div>
            <pre data-user-content data-hook-command className="font-mono text-ui-small break-all whitespace-pre-wrap select-text">
              {entry.command}
            </pre>
          </SettingsCard>
        )
      })}
      {project && project.diagnostics.length > 0 && <Diagnostics diagnostics={project.diagnostics} />}
    </div>
  )
}

function LoadedHooks({ view }: { view: HooksResponse }) {
  const { t } = useI18n()
  const groups = loadedByEvent(view)
  return (
    <div className="mt-2 flex flex-col gap-2" data-hooks-loaded>
      <div className="flex flex-col">
        <h3 className="text-ui-body font-medium">{t('hooks.settings.loaded.title')}</h3>
        <p className="text-ui-small text-muted-foreground">{t('hooks.settings.loaded.hint')}</p>
      </div>
      {groups.length === 0 ? (
        <p className="text-ui-body text-muted-foreground">{t('hooks.settings.loaded.empty')}</p>
      ) : (
        <SettingsCard className="flex flex-col">
          {groups.map(([event, rows]) => (
            <div key={event} data-hooks-event={event} className="flex flex-col gap-1 px-4 py-3 not-last:border-b-hairline not-last:border-border">
              <span className="font-mono text-ui-small font-medium">{event}</span>
              <ul className="flex flex-col gap-1">
                {rows.map((row) => (
                  <li key={row.key} data-loaded-hook={row.key} className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-ui-small">
                    <span className="shrink-0 text-muted-foreground">{t(`hooks.source.${row.source}`)}</span>
                    {row.matcher !== undefined && (
                      <span data-user-content className="shrink-0 text-muted-foreground">
                        {row.matcher}
                      </span>
                    )}
                    <code data-user-content title={row.command} className="min-w-0 flex-1 truncate font-mono">
                      {row.command}
                    </code>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </SettingsCard>
      )}
    </div>
  )
}

function Diagnostics({ diagnostics }: { diagnostics: ResourceDiagnostic[] }) {
  const { t } = useI18n()
  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-muted/50 px-3 py-2" data-hooks-diagnostics={diagnostics.length}>
      <span className="text-ui-small font-medium">{t('hooks.settings.diagnostics.title')}</span>
      <ul className="flex flex-col gap-1.5">
        {diagnostics.map((d, index) => (
          <li key={index} className="flex flex-col" data-diagnostic={d.code}>
            <span className="font-mono text-ui-small">{d.code}</span>
            <span data-user-content className="font-mono text-ui-small break-all text-muted-foreground">
              {d.message}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
