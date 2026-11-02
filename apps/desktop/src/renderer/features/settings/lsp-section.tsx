// 设置 → 代码智能分区：能力开关 lsp.enabled（全局）、全局与当前 Workspace 的服务器 JSON 编辑（Hooks 分区的编辑器样式：保存前校验，诊断行内显示，
// revision 冲突时读回）与已配置的服务器列表（来源、扩展名、状态、stderr 尾部与"重启"）。状态由 lsp_update 进度更新。
import type { LspResponse, LspServersConfig, LspServerStatus, ResourceDiagnostic } from '@coko/protocol'
import { Button, Checkbox, cn, Textarea, toast } from '@coko/ui'
import * as React from 'react'
import { useStore } from 'zustand'
import { useChat, useOptionalChatStoreApi, useActiveWorkspaceId } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { ApiError } from '../../client/api.ts'
import { createConfigClient } from '../../stores/config-store.ts'
import { lspStore, type LspScope, type LspTarget } from '../../stores/lsp-store.ts'
import { SettingsCard } from './settings-page.tsx'

const configClient = createConfigClient()
const format = (servers: LspServersConfig) => JSON.stringify(servers, null, 2)

const STATE_TONE: Record<LspServerStatus['state'], string> = {
  running: 'text-success-text',
  starting: 'text-warning-text',
  failed: 'text-destructive',
  idle: 'text-muted-foreground',
}

export function LspSection() {
  const { t } = useI18n()
  const sessionId = useChat((s) => s.activeSessionId ?? undefined)
  const workspaceId = useActiveWorkspaceId()
  const chat = useOptionalChatStoreApi()
  const status = useStore(lspStore, (s) => s.status)
  const view = useStore(lspStore, (s) => s.view)

  const load = React.useCallback(() => {
    const target: LspTarget | undefined = sessionId !== undefined ? { sessionId } : workspaceId !== undefined ? { workspaceId } : undefined
    return lspStore.getState().load(target)
  }, [sessionId, workspaceId])
  React.useEffect(() => void load(), [load])
  React.useEffect(() => (chat ? lspStore.getState().attach(chat.getState()) : undefined), [chat])

  return (
    <section aria-labelledby="settings-lsp" className="flex flex-col gap-3" data-lsp-section>
      <div className="flex min-w-0 flex-col">
        <h2 id="settings-lsp" className="text-ui-body-lg font-medium">
          {t('lsp.settings')}
        </h2>
        <p className="text-ui-small text-muted-foreground">{t('lsp.section.description')}</p>
      </div>
      {status === 'error' && !view && (
        <div className="flex items-center gap-2" role="alert">
          <p className="text-ui-body text-muted-foreground">{t('lsp.section.loadFailed')}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            {t('lsp.section.retry')}
          </Button>
        </div>
      )}
      {view && (
        <>
          <SettingsCard>
            <EnabledToggle enabled={view.enabled} reload={load} />
          </SettingsCard>
          {!view.enabled && <p className="text-ui-small text-warning-text">{t('lsp.section.disabled')}</p>}
          <ServerList view={view} />
          <ServersEditor scope="global" view={view} />
          {view.workspace ? (
            <ServersEditor scope="workspace" view={view} />
          ) : (
            <p className="text-ui-small text-muted-foreground">{t('lsp.section.noWorkspace')}</p>
          )}
        </>
      )}
    </section>
  )
}

/** lsp.enabled：PUT /api/config 整体替换全局值（其他键原样带回）。 */
function EnabledToggle({ enabled, reload }: { enabled: boolean; reload: () => Promise<void> }) {
  const { t } = useI18n()
  const [busy, setBusy] = React.useState(false)
  const id = React.useId()
  return (
    <div className="flex items-start gap-3 px-4 py-3" data-capability="lsp.enabled">
      <Checkbox
        id={id}
        className="mt-0.5"
        data-capability-enabled={String(enabled)}
        checked={enabled}
        disabled={busy}
        onCheckedChange={async (checked) => {
          setBusy(true)
          try {
            await configClient.update((global) => ({ ...global, lsp: { ...global.lsp, enabled: checked === true } }))
            await reload()
          } catch {
            toast.error(t('lsp.section.enabled.saveFailed'))
          } finally {
            setBusy(false)
          }
        }}
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={id} className="text-ui-body">
          {t('lsp.section.enabled.label')}
        </label>
        <span className="text-ui-small text-muted-foreground">{t('lsp.section.enabled.hint')}</span>
      </div>
    </div>
  )
}

function ServersEditor({ scope, view }: { scope: LspScope; view: LspResponse }) {
  const { t } = useI18n()
  const id = React.useId()
  const current = scope === 'global' ? view.global : view.workspace!
  const saved = format(current.servers)
  const [draft, setDraft] = React.useState(saved)
  const [base, setBase] = React.useState(current.revision)
  const [problem, setProblem] = React.useState<{ message: string; diagnostics: ResourceDiagnostic[]; conflict?: boolean } | null>(null)
  const [saving, setSaving] = React.useState(false)
  // 读回的 revision 变化（保存成功、冲突读回或别处修改）时编辑区换成最新值：渲染期间按 revision 调整状态（不经 effect）。
  if (current.revision !== base) {
    setBase(current.revision)
    setDraft(saved)
  }
  const dirty = draft !== saved

  const save = async () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(draft)
    } catch (error) {
      return setProblem({ message: t('lsp.section.invalidJson', { message: error instanceof Error ? error.message : String(error) }), diagnostics: [] })
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return setProblem({ message: t('lsp.section.notObject'), diagnostics: [] })
    setSaving(true)
    try {
      await lspStore.getState().save(scope, parsed as LspServersConfig)
      setProblem(null)
      toast.success(t('lsp.section.saved'))
    } catch (error) {
      if (error instanceof ApiError && error.code === 'revision-conflict') {
        const latest = lspStore.getState().view
        setProblem({ message: t('lsp.section.conflict'), diagnostics: [], conflict: true })
        setDraft(format((scope === 'global' ? latest?.global.servers : latest?.workspace?.servers) ?? {}))
      } else if (error instanceof ApiError && error.status === 400) {
        const details = error.details as { diagnostics?: ResourceDiagnostic[] } | undefined
        setProblem({ message: details?.diagnostics ? t('lsp.section.invalid') : error.message, diagnostics: details?.diagnostics ?? [] })
      } else {
        toast.error(t('lsp.section.saveFailed'))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2" data-lsp-editor={scope} data-revision={current.revision}>
      <div className="flex flex-col">
        <h3 className="text-ui-body font-medium">{t(`lsp.section.${scope}.title`)}</h3>
        <p className="text-ui-small text-muted-foreground">{t(`lsp.section.${scope}.hint`)}</p>
      </div>
      <label htmlFor={id} className="sr-only">
        {t(`lsp.section.${scope}.editor`)}
      </label>
      <Textarea
        id={id}
        name={`lsp-${scope}`}
        variant="mono"
        rows={8}
        value={draft}
        spellCheck={false}
        aria-invalid={problem !== null && !problem.conflict}
        aria-describedby={problem ? `${id}-problem` : `${id}-format`}
        onChange={(e) => {
          setDraft(e.target.value)
          setProblem(null)
        }}
        className="min-h-40"
      />
      <p id={`${id}-format`} className="font-mono text-ui-small break-all text-muted-foreground">
        {t('lsp.section.format')}
      </p>
      {problem && (
        <div id={`${id}-problem`} role="alert" data-lsp-problem className="flex flex-col gap-1">
          <p className="text-ui-small text-destructive">{problem.message}</p>
          {problem.diagnostics.length > 0 && <Diagnostics diagnostics={problem.diagnostics} />}
        </div>
      )}
      {current.diagnostics.length > 0 && <Diagnostics diagnostics={current.diagnostics} />}
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
          {t('lsp.section.reset')}
        </Button>
        <Button size="sm" data-action={`save-lsp-${scope}`} disabled={!dirty || saving} onClick={() => void save()}>
          {t('lsp.section.save')}
        </Button>
      </div>
    </div>
  )
}

function ServerList({ view }: { view: LspResponse }) {
  const { t } = useI18n()
  const [working, setWorking] = React.useState<string | null>(null)
  return (
    <div className="flex flex-col gap-2" data-lsp-servers>
      <h3 className="text-ui-body font-medium">{t('lsp.section.servers.title')}</h3>
      {view.status.length === 0 ? (
        <p className="text-ui-body text-muted-foreground">{t('lsp.section.servers.empty')}</p>
      ) : (
        <SettingsCard className="flex flex-col">
          {view.status.map((server) => {
            const key = `${server.source}:${server.name}:${server.cwd ?? ''}`
            return (
              <div
                key={key}
                data-lsp-server={server.name}
                data-state={server.state}
                className="flex flex-col gap-1 px-4 py-3 not-last:border-b-hairline not-last:border-border"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span data-user-content className="font-mono text-ui-body font-medium">
                    {server.name}
                  </span>
                  <span className="text-ui-small text-muted-foreground">{t(`lsp.source.${server.source}`)}</span>
                  <span data-user-content className="font-mono text-ui-small text-muted-foreground">
                    {server.extensions.join(' ')}
                  </span>
                  <span data-lsp-state className={cn('text-ui-small', STATE_TONE[server.state])}>
                    {t(`lsp.state.${server.state}`)}
                  </span>
                  {server.pid !== undefined && <span className="text-ui-small text-muted-foreground">{t('lsp.section.servers.pid', { pid: server.pid })}</span>}
                  <span className="flex-1" />
                  <Button
                    variant="outline"
                    size="sm"
                    data-action="restart-lsp"
                    disabled={working !== null}
                    onClick={async () => {
                      setWorking(key)
                      try {
                        await lspStore.getState().restart(server.name, server.cwd)
                      } catch {
                        toast.error(t('lsp.section.servers.restartFailed', { name: server.name }))
                      } finally {
                        setWorking(null)
                      }
                    }}
                  >
                    {t('lsp.section.servers.restart')}
                  </Button>
                </div>
                {server.cwd !== undefined && (
                  <p data-user-content className="font-mono text-ui-small break-all text-muted-foreground">
                    {server.cwd}
                  </p>
                )}
                {server.error !== undefined && (
                  <p data-user-content data-lsp-error className="text-ui-small break-all text-destructive">
                    {server.error}
                  </p>
                )}
                {server.stderrTail !== undefined && (
                  <details className="text-ui-small">
                    <summary className="cursor-pointer text-muted-foreground">{t('lsp.section.servers.stderr')}</summary>
                    <pre data-user-content data-lsp-stderr className="mt-1 max-h-40 overflow-auto font-mono break-all whitespace-pre-wrap select-text">
                      {server.stderrTail}
                    </pre>
                  </details>
                )}
              </div>
            )
          })}
        </SettingsCard>
      )}
    </div>
  )
}

function Diagnostics({ diagnostics }: { diagnostics: ResourceDiagnostic[] }) {
  const { t } = useI18n()
  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-muted/50 px-3 py-2" data-lsp-diagnostics={diagnostics.length}>
      <span className="text-ui-small font-medium">{t('lsp.section.diagnostics')}</span>
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
