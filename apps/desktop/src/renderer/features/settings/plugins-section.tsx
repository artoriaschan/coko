// 设置 → 插件分区（ADR 0017）：从文件夹（目录选择 IPC）或 git 地址与可选 ref 安装；列表显示名字、版本、来源与 commit、状态、
// 贡献计数与诊断；待批准的插件经批准对话框查看全部命令后批准；启用开关、更新（可执行内容变化时提示重新批准）与卸载（确认框）。
import type { MessageKey } from '@coko/i18n'
import { ResourceDiagnostic, type PluginInfo, type PluginStatus } from '@coko/protocol'
import { Button, cn, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Switch, toast } from '@coko/ui'
import { CircleAlertIcon, FolderOpenIcon } from 'lucide-react'
import * as React from 'react'
import { Type } from 'typebox'
import { Value } from 'typebox/value'
import { useStore } from 'zustand'
import { useI18n } from '../../app/i18n.tsx'
import { ApiError } from '../../client/api.ts'
import { pluginsStore } from '../../stores/plugins-store.ts'
import { PluginApprovalDialog } from './plugin-approval-dialog.tsx'
import { SettingsCard } from './settings-page.tsx'

// 状态文字在两套主题下对卡片背景都不低于 4.5:1；--destructive 用于小号文字时达不到，不兼容与无效改用前景色文字加破坏性颜色的图标。
const STATUS_TONE: Record<PluginStatus, string> = {
  'needs-approval': 'text-warning-text',
  enabled: 'text-success-text',
  disabled: 'text-muted-foreground',
  incompatible: 'text-foreground',
  invalid: 'text-foreground',
}

const ERROR_KEYS: Record<string, MessageKey> = {
  'plugin-exists': 'plugins.errors.plugin-exists',
  'plugin-invalid': 'plugins.errors.plugin-invalid',
  'plugin-too-large': 'plugins.errors.plugin-too-large',
  'plugin-source-unreachable': 'plugins.errors.plugin-source-unreachable',
  'bad-request': 'plugins.errors.bad-request',
  forbidden: 'plugins.errors.forbidden',
  'plugin-not-found': 'plugins.errors.plugin-not-found',
  'digest-mismatch': 'plugins.errors.digest-mismatch',
}

const DIAGNOSTIC_KEYS: Record<string, MessageKey> = {
  'invalid-manifest': 'plugins.diagnostics.invalid-manifest',
  'invalid-name': 'plugins.diagnostics.invalid-name',
  'unsupported-field': 'plugins.diagnostics.unsupported-field',
  'incompatible-engine': 'plugins.diagnostics.incompatible-engine',
  'missing-path': 'plugins.diagnostics.missing-path',
  'path-outside-plugin': 'plugins.diagnostics.path-outside-plugin',
  'invalid-server': 'plugins.diagnostics.invalid-server',
  'plugin-secret-reference': 'plugins.diagnostics.plugin-secret-reference',
}

const Diagnostics400 = Type.Object({ diagnostics: Type.Array(ResourceDiagnostic) })

/** 目录选择经 preload（只在 coko-app://app 主窗口中存在）。 */
const pickDirectory = () => (typeof window !== 'undefined' && window.coko ? window.coko.pickDirectory() : Promise.resolve(null))

const errorKey = (error: unknown): MessageKey => (error instanceof ApiError ? ERROR_KEYS[error.code] : undefined) ?? 'plugins.errors.other'

export function PluginsSection() {
  const { t } = useI18n()
  const status = useStore(pluginsStore, (s) => s.status)
  const plugins = useStore(pluginsStore, (s) => s.plugins)
  const [reviewing, setReviewing] = React.useState<string | null>(null)
  const [uninstalling, setUninstalling] = React.useState<string | null>(null)

  React.useEffect(() => void pluginsStore.getState().load(), [])

  return (
    <section aria-labelledby="settings-plugins" className="flex flex-col gap-3" data-plugins-section>
      <div className="flex min-w-0 flex-col">
        <h2 id="settings-plugins" className="text-ui-body-lg font-medium">
          {t('plugins.title')}
        </h2>
        <p className="text-ui-small text-muted-foreground">{t('plugins.description')}</p>
      </div>
      <InstallPanel onInstalled={(name) => setReviewing(name)} />
      {(status === 'idle' || status === 'loading') && plugins.length === 0 && <ListSkeleton />}
      {status === 'error' && plugins.length === 0 && (
        <div className="flex items-center gap-2" role="alert">
          <p className="text-ui-body text-muted-foreground">{t('plugins.loadFailed')}</p>
          <Button variant="outline" size="sm" onClick={() => void pluginsStore.getState().load()}>
            {t('plugins.retry')}
          </Button>
        </div>
      )}
      {status === 'ready' && plugins.length === 0 && (
        <p data-plugins-empty className="py-2 text-ui-body text-muted-foreground">
          {t('plugins.empty')}
        </p>
      )}
      {plugins.length > 0 && (
        <ul className="flex flex-col gap-2" data-plugins-list>
          {plugins.map((plugin) => (
            <li key={plugin.name}>
              <PluginCard plugin={plugin} onReview={() => setReviewing(plugin.name)} onUninstall={() => setUninstalling(plugin.name)} />
            </li>
          ))}
        </ul>
      )}
      {reviewing !== null && <PluginApprovalDialog key={reviewing} name={reviewing} onClose={() => setReviewing(null)} />}
      {uninstalling !== null && <UninstallDialog key={uninstalling} name={uninstalling} onClose={() => setUninstalling(null)} />}
    </section>
  )
}

function ListSkeleton() {
  return (
    <div aria-hidden data-plugins-skeleton className="flex flex-col gap-2">
      {[0, 1].map((i) => (
        <div key={i} className="h-20 rounded-xl bg-skeleton" />
      ))}
    </div>
  )
}

interface Problem {
  message: string
  detail: string | null
  diagnostics: ResourceDiagnostic[]
}

function InstallPanel({ onInstalled }: { onInstalled: (name: string) => void }) {
  const { t } = useI18n()
  const id = React.useId()
  const [url, setUrl] = React.useState('')
  const [ref, setRef] = React.useState('')
  const [installing, setInstalling] = React.useState(false)
  const [problem, setProblem] = React.useState<Problem | null>(null)

  const install = async (source: Parameters<ReturnType<typeof pluginsStore.getState>['install']>[0]) => {
    setInstalling(true)
    setProblem(null)
    try {
      const plugin = await pluginsStore.getState().install(source)
      toast.success(t('plugins.install.installed', { name: plugin.name }))
      setUrl('')
      setRef('')
      if (plugin.status === 'needs-approval') onInstalled(plugin.name)
    } catch (error) {
      const details = error instanceof ApiError ? error.details : undefined
      setProblem({
        message: t(errorKey(error)),
        detail: error instanceof ApiError && !(error.code in ERROR_KEYS) ? error.message : null,
        diagnostics: Value.Check(Diagnostics400, details) ? details.diagnostics : [],
      })
    } finally {
      setInstalling(false)
    }
  }
  const fromFolder = async () => {
    const path = await pickDirectory()
    if (path) await install({ kind: 'dir', path })
  }
  const fromGit = (event: React.FormEvent) => {
    event.preventDefault()
    const trimmed = url.trim()
    if (trimmed === '') return setProblem({ message: t('plugins.install.urlRequired'), detail: null, diagnostics: [] })
    void install({ kind: 'git', url: trimmed, ...(ref.trim() === '' ? {} : { ref: ref.trim() }) })
  }

  return (
    <SettingsCard data-plugin-install className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-ui-body font-medium">{t('plugins.install.title')}</h3>
        <Button variant="outline" size="sm" data-action="install-folder" disabled={installing} onClick={() => void fromFolder()}>
          <FolderOpenIcon />
          {t('plugins.install.folder')}
        </Button>
      </div>
      <form className="flex flex-wrap items-end gap-2" onSubmit={fromGit} noValidate data-plugin-git-form>
        <div className="flex min-w-48 flex-[2] flex-col gap-1.5">
          <label htmlFor={`${id}-url`} className="text-ui-small text-muted-foreground">
            {t('plugins.install.gitUrl')}
          </label>
          <Input
            id={`${id}-url`}
            name="gitUrl"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t('plugins.install.gitUrlPlaceholder')}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="flex min-w-32 flex-1 flex-col gap-1.5">
          <label htmlFor={`${id}-ref`} className="text-ui-small text-muted-foreground">
            {t('plugins.install.ref')}
          </label>
          <Input id={`${id}-ref`} name="gitRef" value={ref} onChange={(e) => setRef(e.target.value)} autoComplete="off" spellCheck={false} />
        </div>
        <Button type="submit" size="sm" data-action="install-git" disabled={installing}>
          {installing ? t('plugins.install.installing') : t('plugins.install.submit')}
        </Button>
      </form>
      {problem && (
        <div role="alert" data-install-problem className="flex flex-col gap-1.5">
          <p className="text-ui-small break-words text-destructive">{problem.message}</p>
          {problem.diagnostics.length > 0 && <Diagnostics diagnostics={problem.diagnostics} />}
          {problem.detail !== null && (
            <details className="text-ui-small text-muted-foreground" data-error-detail>
              <summary className="cursor-default">{t('plugins.errorDetails')}</summary>
              <p data-user-content className="mt-1 font-mono break-words select-text">
                {problem.detail}
              </p>
            </details>
          )}
        </div>
      )}
    </SettingsCard>
  )
}

function contributionCounts(plugin: PluginInfo, t: ReturnType<typeof useI18n>['t']): string[] {
  const counts: [MessageKey, number][] = [
    ['plugins.contributions.skills', plugin.contributions.skills.length],
    ['plugins.contributions.commands', plugin.contributions.commands.length],
    ['plugins.contributions.agents', plugin.contributions.agents.length],
    ['plugins.contributions.hooks', plugin.executables.hooks.length],
    ['plugins.contributions.mcpServers', plugin.executables.mcpServers.length],
    ['plugins.contributions.lspServers', plugin.executables.lspServers.length],
  ]
  return counts.filter(([, count]) => count > 0).map(([key, count]) => t(key, { count }))
}

function PluginCard({ plugin, onReview, onUninstall }: { plugin: PluginInfo; onReview: () => void; onUninstall: () => void }) {
  const { t } = useI18n()
  const [working, setWorking] = React.useState(false)
  const run = async (task: () => Promise<unknown>) => {
    setWorking(true)
    try {
      await task()
    } catch (error) {
      toast.error(`${t('plugins.actionFailed', { name: plugin.name })}: ${t(errorKey(error))}`)
    } finally {
      setWorking(false)
    }
  }
  const update = () =>
    run(async () => {
      const { plugin: next, digestChanged } = await pluginsStore.getState().update(plugin.name)
      if (digestChanged && next.status === 'needs-approval') toast.warning(t('plugins.updatedNeedsApproval', { name: plugin.name }))
      else toast.success(t('plugins.updated', { name: plugin.name }))
    })
  const toggleable = plugin.status === 'enabled' || plugin.status === 'disabled'
  const counts = contributionCounts(plugin, t)
  const { source } = plugin
  return (
    <SettingsCard data-plugin={plugin.name} data-status={plugin.status} className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span data-user-content className="font-mono text-ui-body font-medium break-all">
              {plugin.name}
            </span>
            <span data-user-content data-plugin-version className="text-ui-small text-muted-foreground">
              {plugin.version}
            </span>
            <span data-plugin-status className={cn('inline-flex items-center gap-1 self-center text-ui-small', STATUS_TONE[plugin.status])}>
              {(plugin.status === 'incompatible' || plugin.status === 'invalid') && (
                <CircleAlertIcon aria-hidden className="size-3.5 shrink-0 text-destructive" />
              )}
              {t(`plugins.status.${plugin.status}`)}
            </span>
          </div>
          {plugin.description !== undefined && (
            <p data-user-content className="text-ui-small text-muted-foreground">
              {plugin.description}
            </p>
          )}
          <p data-plugin-source className="text-ui-small break-all text-muted-foreground">
            {t(`plugins.source.${source.kind}`)} · <span data-user-content>{source.location}</span>
            {source.ref !== undefined && <> · {t('plugins.source.ref', { ref: source.ref })}</>}
            {source.commit !== undefined && (
              <>
                {' · '}
                <span title={source.commit} data-plugin-commit={source.commit}>
                  {t('plugins.source.commit', { commit: source.commit.slice(0, 7) })}
                </span>
              </>
            )}
          </p>
          {counts.length > 0 && (
            <p data-plugin-counts className="text-ui-small text-muted-foreground">
              {counts.join(' · ')}
            </p>
          )}
          {plugin.status === 'incompatible' && <p className="text-ui-small">{t('plugins.incompatibleHint')}</p>}
          {plugin.status === 'invalid' && <p className="text-ui-small">{t('plugins.invalidHint')}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {plugin.status === 'needs-approval' && (
            <Button size="sm" data-action="review" disabled={working} onClick={onReview}>
              {t('plugins.review')}
            </Button>
          )}
          {toggleable && (
            <Switch
              data-action="toggle"
              aria-label={t('plugins.enabled', { name: plugin.name })}
              checked={plugin.status === 'enabled'}
              disabled={working}
              onCheckedChange={(enabled) => void run(() => pluginsStore.getState().setEnabled(plugin.name, enabled))}
            />
          )}
          <Button variant="outline" size="sm" data-action="update" disabled={working} onClick={() => void update()}>
            {t('plugins.update')}
          </Button>
          <Button variant="ghost" size="sm" data-action="uninstall" disabled={working} onClick={onUninstall}>
            {t('plugins.uninstall')}
          </Button>
        </div>
      </div>
      {plugin.diagnostics.length > 0 && <Diagnostics diagnostics={plugin.diagnostics} />}
    </SettingsCard>
  )
}

function UninstallDialog({ name, onClose }: { name: string; onClose: () => void }) {
  const { t } = useI18n()
  const [working, setWorking] = React.useState(false)
  const confirm = async () => {
    setWorking(true)
    try {
      await pluginsStore.getState().uninstall(name)
      toast.success(t('plugins.uninstalled', { name }))
      onClose()
    } catch (error) {
      toast.error(`${t('plugins.actionFailed', { name })}: ${t(errorKey(error))}`)
      setWorking(false)
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent role="alertdialog" className="max-w-[440px] gap-3 p-5" data-plugin-uninstall={name}>
        <DialogTitle>{t('plugins.confirmUninstall.title', { name })}</DialogTitle>
        <DialogDescription>{t('plugins.confirmUninstall.description')}</DialogDescription>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={working} onClick={onClose}>
            {t('plugins.confirmUninstall.cancel')}
          </Button>
          <Button variant="destructive" size="sm" data-action="confirm-uninstall" disabled={working} onClick={() => void confirm()}>
            {t('plugins.confirmUninstall.confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Diagnostics({ diagnostics }: { diagnostics: ResourceDiagnostic[] }) {
  const { t } = useI18n()
  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-muted/50 px-3 py-2" data-plugin-diagnostics={diagnostics.length}>
      <span className="text-ui-small font-medium">{t('plugins.diagnostics.title')}</span>
      <ul className="flex flex-col gap-1.5">
        {diagnostics.map((d, index) => (
          <li key={index} className="flex flex-col" data-diagnostic={d.code}>
            <span className="text-ui-small">{t(DIAGNOSTIC_KEYS[d.code] ?? 'plugins.diagnostics.other')}</span>
            <span data-user-content className="font-mono text-ui-small break-all text-muted-foreground">
              {d.path !== undefined ? `${d.path}: ${d.message}` : d.message}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
