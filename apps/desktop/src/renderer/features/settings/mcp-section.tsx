// MCP 与 Secrets 分区（票 07）：全局与当前工作区的 Server（状态、工具数、启停、增改删、项目 Server 批准、重连）与 Secrets 子区。
// 状态来自 GET /api/mcp（分区打开期间轮询）；Secret 的值只经 preload setSecret 交给 main（ADR 0007），界面只显示末四位。
import type { MessageKey } from '@coko/i18n'
import type { McpServerInfo, McpServerStatus, McpServersConfig, ResourceDiagnostic } from '@coko/protocol'
import { Button, cn, Dialog, DialogContent, DialogDescription, DialogTitle, Input, toast, ToggleGroup, ToggleGroupItem } from '@coko/ui'
import { ChevronDownIcon, KeyRoundIcon, PlusIcon, RefreshCwIcon } from 'lucide-react'
import * as React from 'react'
import { useStore } from 'zustand'
import { useChat } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { mcpStore } from '../../stores/mcp-store.ts'
import { SettingsCard } from './settings-dialog.tsx'

const POLL_MS = 750
const textarea =
  'box-border min-h-16 w-full min-w-0 rounded-md border-hairline border-input bg-background px-3 py-1.5 font-mono text-ui-small text-foreground focus-ring placeholder:text-muted-foreground'

const STATUS_TONE: Record<McpServerStatus, string> = {
  idle: 'text-muted-foreground',
  connecting: 'text-muted-foreground',
  connected: 'text-success',
  failed: 'text-destructive',
  disabled: 'text-muted-foreground',
  'pending-approval': 'text-warning',
}

const DIAGNOSTIC_KEYS: Record<string, MessageKey> = {
  'invalid-server': 'mcp.diagnostics.invalid-server',
  'project-secret-reference': 'mcp.diagnostics.project-secret-reference',
  'shadowed-by-global': 'mcp.diagnostics.shadowed-by-global',
  'name-conflict': 'mcp.diagnostics.name-conflict',
  'invalid-json': 'mcp.diagnostics.invalid-json',
  'invalid-value': 'mcp.diagnostics.invalid-value',
  'read-failed': 'mcp.diagnostics.read-failed',
}

export function McpSection() {
  const { t } = useI18n()
  const activeWorkspaceId = useChat((s) => s.sessions.find((x) => x.id === s.activeSessionId)?.workspaceId)
  const draftWorkspaceId = useChat((s) => s.draftWorkspaceId)
  const workspaceId = activeWorkspaceId ?? draftWorkspaceId ?? undefined
  const status = useStore(mcpStore, (s) => s.status)
  const data = useStore(mcpStore, (s) => s.data)
  const [editing, setEditing] = React.useState<{ name?: string } | null>(null)

  React.useEffect(() => {
    const load = () => void mcpStore.getState().load(workspaceId)
    load()
    void mcpStore.getState().loadSecrets()
    const timer = setInterval(load, POLL_MS)
    return () => clearInterval(timer)
  }, [workspaceId])

  const servers = data?.servers ?? []
  const global = servers.filter((s) => s.scope === 'global')
  const project = servers.filter((s) => s.scope === 'project')

  return (
    <section aria-labelledby="settings-mcp" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <h2 id="settings-mcp" className="text-ui-body-lg font-medium">
            {t('mcp.title')}
          </h2>
          <p className="text-ui-small text-muted-foreground">{t('mcp.description')}</p>
        </div>
        <Button variant="outline" size="sm" disabled={!data || editing !== null} onClick={() => setEditing({})}>
          <PlusIcon />
          {t('mcp.add')}
        </Button>
      </div>
      {data && !data.enabled && <p className="text-ui-small text-warning">{t('mcp.disabled')}</p>}
      {workspaceId === undefined && <p className="text-ui-small text-muted-foreground">{t('mcp.noWorkspace')}</p>}
      {status === 'error' && !data && <p className="text-ui-body text-muted-foreground">{t('mcp.loadFailed')}</p>}

      {editing && <ServerForm key={editing.name ?? 'new'} name={editing.name} onDone={() => setEditing(null)} />}

      {data && global.length === 0 && project.length === 0 && !editing && <p className="py-2 text-ui-body text-muted-foreground">{t('mcp.empty')}</p>}
      {global
        .filter((s) => s.name !== editing?.name)
        .map((s) => (
          <ServerCard key={`global:${s.name}`} server={s} busy={editing !== null} onEdit={() => setEditing({ name: s.name })} />
        ))}

      {project.length > 0 && (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex flex-col">
            <h3 className="text-ui-body font-medium">{t('mcp.project.title')}</h3>
            <p className="text-ui-small text-muted-foreground">{t('mcp.project.hint')}</p>
          </div>
          {project.map((s) => (
            <ServerCard key={`project:${s.name}`} server={s} busy={false} />
          ))}
        </div>
      )}
      {data && data.diagnostics.length > 0 && <Diagnostics diagnostics={data.diagnostics} />}
      <SecretsPanel />
    </section>
  )
}

function ServerCard({ server, busy, onEdit }: { server: McpServerInfo; busy: boolean; onEdit?: () => void }) {
  const { t } = useI18n()
  const [showTools, setShowTools] = React.useState(false)
  const [confirming, setConfirming] = React.useState(false)
  const [reviewing, setReviewing] = React.useState(false)
  const [working, setWorking] = React.useState(false)
  const toolsId = React.useId()
  const run = async (task: () => Promise<{ ok: boolean }>, failure: MessageKey) => {
    setWorking(true)
    const result = await task()
    setWorking(false)
    if (!result.ok) toast.error(t(failure))
  }
  const toggle = () =>
    run(
      () =>
        mcpStore.getState().updateServers((current) => {
          const { enabled: _enabled, ...rest } = (current[server.name] ?? {}) as Record<string, unknown>
          return { ...current, [server.name]: server.enabled ? { ...rest, enabled: false } : rest }
        }),
      'mcp.saveFailed',
    )
  const remove = () =>
    run(
      () =>
        mcpStore.getState().updateServers((current) => {
          const { [server.name]: _removed, ...rest } = current
          return rest
        }),
      'mcp.saveFailed',
    )
  const canReconnect = server.status === 'failed' || server.status === 'connected' || server.status === 'idle'
  return (
    <SettingsCard
      data-mcp-server={server.name}
      data-scope={server.scope}
      data-status={server.status}
      data-tool-count={server.tools.length}
      className="flex flex-col gap-2 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-baseline gap-2">
            <span data-user-content className="truncate font-mono text-ui-body font-medium" title={server.name}>
              {server.name}
            </span>
            <span className="shrink-0 text-ui-small text-muted-foreground">
              {t(`mcp.scope.${server.scope}`)} · {t(`mcp.transport.${server.transport}`)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-ui-small">
            <span data-mcp-status className={STATUS_TONE[server.status]}>
              {t(`mcp.status.${server.status}`)}
            </span>
            {server.status === 'connected' && (
              <button
                type="button"
                data-mcp-tools={server.tools.length}
                aria-expanded={showTools}
                aria-controls={toolsId}
                className="inline-flex items-center gap-1 rounded-md px-1 text-muted-foreground hover:bg-accent focus-ring"
                onClick={() => setShowTools((v) => !v)}
              >
                {t('mcp.tools', { count: server.tools.length })}
                <ChevronDownIcon className={cn('size-3.5 transition-transform motion-reduce:transition-none', showTools && 'rotate-180')} />
              </button>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1">
          {server.scope === 'project' && server.approval && !server.approval.approved && (
            <Button size="sm" data-action="review" onClick={() => setReviewing(true)}>
              {t('mcp.project.review')}
            </Button>
          )}
          {server.scope === 'project' && server.approval?.approved && (
            <Button
              variant="ghost"
              size="sm"
              data-action="revoke"
              disabled={working}
              onClick={() => void run(() => mcpStore.getState().approve(server.name, server.approval!.digest, false), 'mcp.saveFailed')}
            >
              {t('mcp.project.revoke')}
            </Button>
          )}
          {canReconnect && server.status !== 'idle' && (
            <Button
              variant="ghost"
              size="sm"
              data-action="reconnect"
              disabled={working}
              onClick={() => void run(() => mcpStore.getState().reconnect(server.name), 'mcp.reconnectFailed')}
            >
              <RefreshCwIcon />
              {t('mcp.reconnect')}
            </Button>
          )}
          {server.scope === 'global' &&
            (confirming ? (
              <>
                <Button variant="destructive" size="sm" disabled={working} onClick={() => void remove()}>
                  {t('mcp.confirmDelete')}
                </Button>
                <Button variant="ghost" size="sm" disabled={working} onClick={() => setConfirming(false)}>
                  {t('mcp.cancel')}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" data-action="toggle" disabled={busy || working} onClick={() => void toggle()}>
                  {server.enabled ? t('mcp.disable') : t('mcp.enable')}
                </Button>
                <Button variant="outline" size="sm" data-action="edit" disabled={busy || working} onClick={onEdit}>
                  {t('mcp.edit')}
                </Button>
                <Button variant="ghost" size="sm" data-action="delete" disabled={busy || working} onClick={() => setConfirming(true)}>
                  {t('mcp.delete')}
                </Button>
              </>
            ))}
        </div>
      </div>
      {showTools && server.status === 'connected' && (
        <ul id={toolsId} className="flex flex-col gap-0.5 rounded-lg bg-muted/50 px-3 py-2">
          {server.tools.map((tool) => (
            <li key={tool.name} data-mcp-tool={tool.name} className="flex min-w-0 flex-col">
              <span data-user-content className="font-mono text-ui-small">
                {tool.name}
              </span>
              {tool.description && (
                <span data-user-content className="truncate text-ui-small text-muted-foreground">
                  {tool.description}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {server.status === 'failed' && (server.error || server.stderrTail) && (
        <div className="flex flex-col gap-1 rounded-lg bg-muted/50 px-3 py-2" data-mcp-error>
          {server.error && (
            <p data-user-content className="text-ui-small break-words text-destructive">
              {server.error}
            </p>
          )}
          {server.stderrTail && (
            <details className="text-ui-small text-muted-foreground">
              <summary className="cursor-pointer select-none">{t('mcp.stderr')}</summary>
              <pre data-user-content data-mcp-stderr className="mt-1 font-mono text-ui-small break-words whitespace-pre-wrap select-text">
                {server.stderrTail}
              </pre>
            </details>
          )}
        </div>
      )}
      {reviewing && server.approval && <ApprovalDialog server={server} onClose={() => setReviewing(false)} />}
    </SettingsCard>
  )
}

function ApprovalDialog({ server, onClose }: { server: McpServerInfo; onClose: () => void }) {
  const { t } = useI18n()
  const [working, setWorking] = React.useState(false)
  const launch = server.approval!.launch
  const rows: [MessageKey, string | string[] | undefined][] = [
    ['mcp.project.command', launch.command],
    ['mcp.project.args', launch.args],
    ['mcp.project.cwd', launch.cwd],
    ['mcp.project.url', launch.url],
    ['mcp.project.envNames', launch.envNames],
    ['mcp.project.headerNames', launch.headerNames],
  ]
  const approve = async () => {
    setWorking(true)
    const result = await mcpStore.getState().approve(server.name, server.approval!.digest, true)
    setWorking(false)
    if (result.ok) onClose()
    else toast.error(t('mcp.project.approveFailed'))
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t('mcp.cancel')} className="max-w-[560px] flex-col gap-3 p-5" data-mcp-approval={server.name}>
        <DialogTitle>{t('mcp.project.dialogTitle')}</DialogTitle>
        <DialogDescription>{t('mcp.project.dialogDescription')}</DialogDescription>
        <p data-user-content className="font-mono text-ui-body font-medium">
          {server.name}
        </p>
        <dl className="flex flex-col gap-2">
          {rows
            .filter(([, value]) => value !== undefined)
            .map(([label, value]) => (
              <div key={label} className="flex flex-col gap-0.5">
                <dt className="text-ui-small text-muted-foreground">{t(label)}</dt>
                <dd data-user-content data-launch={label.split('.').at(-1)} className="font-mono text-ui-small break-all select-text">
                  {Array.isArray(value) ? (value.length === 0 ? t('mcp.project.none') : value.join(' ')) : value}
                </dd>
              </div>
            ))}
        </dl>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={working} onClick={onClose}>
            {t('mcp.cancel')}
          </Button>
          <Button size="sm" data-action="approve" disabled={working} onClick={() => void approve()}>
            {t('mcp.project.approve')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const lines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

/** NAME=value（sep '='）或 Name: value（sep ':'）的行 → 对象；格式不对的行返回 { invalid }。 */
function pairs(text: string, sep: '=' | ':'): Record<string, string> | { invalid: string } {
  const out: Record<string, string> = {}
  for (const line of lines(text)) {
    const at = line.indexOf(sep)
    if (at <= 0) return { invalid: line }
    out[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return out
}

const toLines = (record: unknown, sep: string) =>
  record && typeof record === 'object'
    ? Object.entries(record as Record<string, string>)
        .map(([k, v]) => `${k}${sep}${v}`)
        .join('\n')
    : ''

function ServerForm({ name: initialName, onDone }: { name?: string | undefined; onDone: () => void }) {
  const { t } = useI18n()
  const id = React.useId()
  const existing = (initialName ? mcpStore.getState().data?.global[initialName] : undefined) as Record<string, unknown> | undefined
  const [name, setName] = React.useState(initialName ?? '')
  const [transport, setTransport] = React.useState<'stdio' | 'http'>(typeof existing?.url === 'string' ? 'http' : 'stdio')
  const [command, setCommand] = React.useState(typeof existing?.command === 'string' ? existing.command : '')
  const [args, setArgs] = React.useState(Array.isArray(existing?.args) ? (existing.args as string[]).join('\n') : '')
  const [env, setEnv] = React.useState(toLines(existing?.env, '='))
  const [cwd, setCwd] = React.useState(typeof existing?.cwd === 'string' ? existing.cwd : '')
  const [url, setUrl] = React.useState(typeof existing?.url === 'string' ? existing.url : '')
  const [headers, setHeaders] = React.useState(toLines(existing?.headers, ': '))
  const [timeout, setTimeoutValue] = React.useState(typeof existing?.timeout === 'number' ? String(existing.timeout) : '')
  const [disabledTools, setDisabledTools] = React.useState(Array.isArray(existing?.disabledTools) ? (existing.disabledTools as string[]).join(', ') : '')
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed === '') return setError(t('mcp.form.nameRequired'))
    const common: Record<string, unknown> = {}
    if (existing?.enabled === false) common.enabled = false
    if (timeout.trim() !== '') common.timeout = Number(timeout)
    const disabled = disabledTools
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (disabled.length > 0) common.disabledTools = disabled
    let config: Record<string, unknown>
    if (transport === 'stdio') {
      if (command.trim() === '') return setError(t('mcp.form.targetRequired'))
      const parsedEnv = pairs(env, '=')
      if ('invalid' in parsedEnv && typeof parsedEnv.invalid === 'string') return setError(t('mcp.form.invalidLine', { line: parsedEnv.invalid }))
      config = { command: command.trim(), ...common }
      const argList = lines(args)
      if (argList.length > 0) config.args = argList
      if (Object.keys(parsedEnv).length > 0) config.env = parsedEnv
      if (cwd.trim() !== '') config.cwd = cwd.trim()
    } else {
      if (url.trim() === '') return setError(t('mcp.form.targetRequired'))
      const parsedHeaders = pairs(headers, ':')
      if ('invalid' in parsedHeaders && typeof parsedHeaders.invalid === 'string') return setError(t('mcp.form.invalidLine', { line: parsedHeaders.invalid }))
      config = { type: 'http', url: url.trim(), ...common }
      if (Object.keys(parsedHeaders).length > 0) config.headers = parsedHeaders
    }
    setError(null)
    setSaving(true)
    const result = await mcpStore.getState().updateServers((current: McpServersConfig) => {
      const next = { ...current }
      if (initialName && initialName !== trimmed) delete next[initialName]
      next[trimmed] = config
      return next
    })
    setSaving(false)
    if (result.ok) {
      toast.success(t('mcp.saved'))
      onDone()
      return
    }
    setError(result.code === 'revision-conflict' ? t('mcp.conflict') : `${t('mcp.saveFailed')}: ${result.message}`)
  }

  const field = (key: string, label: MessageKey, control: React.ReactNode) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${id}-${key}`} className="text-ui-small text-muted-foreground">
        {t(label)}
      </label>
      {control}
    </div>
  )
  return (
    <SettingsCard data-mcp-form className="px-4 py-3">
      <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)} noValidate>
        {field(
          'name',
          'mcp.form.name',
          <Input id={`${id}-name`} name="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" spellCheck={false} />,
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-ui-small text-muted-foreground">{t('mcp.form.transport')}</span>
          <ToggleGroup
            type="single"
            aria-label={t('mcp.form.transport')}
            value={transport}
            onValueChange={(value) => value && setTransport(value as 'stdio' | 'http')}
          >
            <ToggleGroupItem value="stdio" data-transport="stdio">
              {t('mcp.transport.stdio')}
            </ToggleGroupItem>
            <ToggleGroupItem value="http" data-transport="http">
              {t('mcp.transport.http')}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        {transport === 'stdio' ? (
          <>
            {field(
              'command',
              'mcp.form.command',
              <Input id={`${id}-command`} name="command" value={command} onChange={(e) => setCommand(e.target.value)} autoComplete="off" spellCheck={false} />,
            )}
            {field(
              'args',
              'mcp.form.args',
              <textarea id={`${id}-args`} name="args" className={textarea} value={args} onChange={(e) => setArgs(e.target.value)} spellCheck={false} />,
            )}
            {field(
              'env',
              'mcp.form.env',
              <textarea id={`${id}-env`} name="env" className={textarea} value={env} onChange={(e) => setEnv(e.target.value)} spellCheck={false} />,
            )}
            {field(
              'cwd',
              'mcp.form.cwd',
              <Input id={`${id}-cwd`} name="cwd" value={cwd} onChange={(e) => setCwd(e.target.value)} autoComplete="off" spellCheck={false} />,
            )}
          </>
        ) : (
          <>
            {field(
              'url',
              'mcp.form.url',
              <Input id={`${id}-url`} name="url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} autoComplete="off" spellCheck={false} />,
            )}
            {field(
              'headers',
              'mcp.form.headers',
              <textarea
                id={`${id}-headers`}
                name="headers"
                className={textarea}
                value={headers}
                onChange={(e) => setHeaders(e.target.value)}
                spellCheck={false}
              />,
            )}
          </>
        )}
        {field(
          'timeout',
          'mcp.form.timeout',
          <Input id={`${id}-timeout`} name="timeout" inputMode="numeric" value={timeout} onChange={(e) => setTimeoutValue(e.target.value)} placeholder="60" />,
        )}
        {field(
          'disabledTools',
          'mcp.form.disabledTools',
          <Input
            id={`${id}-disabledTools`}
            name="disabledTools"
            value={disabledTools}
            onChange={(e) => setDisabledTools(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />,
        )}
        {error !== null && (
          <p role="alert" className="text-ui-small break-words text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onDone}>
            {t('mcp.cancel')}
          </Button>
          <Button type="submit" size="sm" disabled={saving}>
            {t('mcp.save')}
          </Button>
        </div>
      </form>
    </SettingsCard>
  )
}

function Diagnostics({ diagnostics }: { diagnostics: ResourceDiagnostic[] }) {
  const { t } = useI18n()
  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-muted/50 px-3 py-2" data-mcp-diagnostics={diagnostics.length}>
      <span className="text-ui-small font-medium">{t('mcp.diagnostics.title')}</span>
      <ul className="flex flex-col gap-1.5">
        {diagnostics.map((d, index) => (
          <li key={index} className="flex flex-col" data-diagnostic={d.code}>
            <span className="text-ui-small">{t(DIAGNOSTIC_KEYS[d.code] ?? 'mcp.diagnostics.other')}</span>
            <span data-user-content className="font-mono text-ui-small break-all text-muted-foreground">
              {d.message}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SecretsPanel() {
  const { t } = useI18n()
  const secrets = useStore(mcpStore, (s) => s.secrets)
  const id = React.useId()
  const [name, setName] = React.useState('')
  const [value, setValue] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const environment = secrets?.source === 'environment'

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    const trimmed = name.trim()
    const result = await mcpStore.getState().setSecret(trimmed, value)
    setSaving(false)
    if (result.ok) {
      // 值只在提交前留在输入框；保存后立即清空。
      setValue('')
      setName('')
      setError(null)
      toast.success(t('mcp.secrets.saved', { name: trimmed }))
      return
    }
    setError(t(`mcp.secrets.errors.${result.code}`))
  }
  const remove = async (secret: string) => {
    const result = await mcpStore.getState().deleteSecret(secret)
    if (result.ok) toast.success(t('mcp.secrets.deleted', { name: secret }))
    else toast.error(result.message)
  }
  return (
    <div className="mt-2 flex flex-col gap-2" data-secrets>
      <div className="flex flex-col">
        <h3 className="text-ui-body font-medium">{t('mcp.secrets.title')}</h3>
        <p className="text-ui-small text-muted-foreground">{t('mcp.secrets.description')}</p>
      </div>
      {environment && <p className="text-ui-small text-muted-foreground">{t('mcp.secrets.environment')}</p>}
      <SettingsCard>
        {secrets && secrets.secrets.length === 0 && <p className="px-4 py-3 text-ui-body text-muted-foreground">{t('mcp.secrets.empty')}</p>}
        {secrets?.secrets.map((secret) => (
          <div key={secret.name} data-secret={secret.name} className="flex items-center gap-3 px-4 py-2 not-last:border-b-hairline not-last:border-border">
            <KeyRoundIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <span data-user-content className="min-w-0 flex-1 truncate font-mono text-ui-body">
              {secret.name}
            </span>
            <span data-secret-hint className="shrink-0 text-ui-small text-muted-foreground">
              {secret.hint ? t('mcp.secrets.hint', { hint: secret.hint }) : t('mcp.secrets.noHint')}
            </span>
            {!environment && (
              <Button variant="ghost" size="sm" onClick={() => void remove(secret.name)}>
                {t('mcp.secrets.delete')}
              </Button>
            )}
          </div>
        ))}
      </SettingsCard>
      {!environment && (
        <form data-secret-form className="flex flex-wrap items-end gap-2" onSubmit={(event) => void submit(event)} noValidate>
          <div className="flex min-w-40 flex-1 flex-col gap-1.5">
            <label htmlFor={`${id}-name`} className="text-ui-small text-muted-foreground">
              {t('mcp.secrets.name')}
            </label>
            <Input
              id={`${id}-name`}
              name="secretName"
              value={name}
              onChange={(e) => setName(e.target.value.toUpperCase())}
              autoComplete="off"
              spellCheck={false}
              placeholder={t('mcp.secrets.namePlaceholder')}
            />
          </div>
          <div className="flex min-w-40 flex-1 flex-col gap-1.5">
            <label htmlFor={`${id}-value`} className="text-ui-small text-muted-foreground">
              {t('mcp.secrets.value')}
            </label>
            <Input
              id={`${id}-value`}
              name="secretValue"
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <Button type="submit" size="sm" disabled={saving || name.trim() === '' || value === ''}>
            {t('mcp.secrets.add')}
          </Button>
          {error !== null && (
            <p role="alert" className="basis-full text-ui-small text-destructive">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  )
}
