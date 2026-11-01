// 插件批准对话框（ADR 0017）：显示批准后会执行的全部内容（每条 Hook 的事件、matcher 与完整命令；每个 MCP / 语言服务器的命令、参数、
// 地址与环境变量的键）以及 Skills、命令、子代理的名字。只有点"批准"才发 POST /api/plugins/:name/approve，digest 取所显示内容的 digest；
// 打开期间内容变化（读回或 409 digest-mismatch 后读回）时显示提示，界面换成最新内容。
import type { PluginInfo } from '@coko/protocol'
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, toast } from '@coko/ui'
import * as React from 'react'
import { useStore } from 'zustand'
import { useI18n } from '../../app/i18n.tsx'
import { ApiError } from '../../client/api.ts'
import { pluginsStore } from '../../stores/plugins-store.ts'

export function PluginApprovalDialog({ name, onClose }: { name: string; onClose: () => void }) {
  const { t } = useI18n()
  const plugin = useStore(pluginsStore, (s) => s.plugins.find((p) => p.name === name))
  const [openedDigest] = React.useState(plugin?.digest)
  const [working, setWorking] = React.useState(false)
  if (!plugin) return null
  const changed = plugin.digest !== openedDigest

  const approve = async () => {
    setWorking(true)
    try {
      await pluginsStore.getState().approve(plugin.name, plugin.digest)
      toast.success(t('plugins.approval.approved', { name: plugin.name }))
      onClose()
    } catch (error) {
      // digest-mismatch：store 已读回最新内容，对话框显示"已变化"并换成新内容，不关闭。
      if (!(error instanceof ApiError && error.code === 'digest-mismatch')) toast.error(t('plugins.approval.failed'))
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[640px] gap-3 p-5" data-plugin-approval={plugin.name} data-digest={plugin.digest}>
        <div className="flex flex-col gap-1">
          <DialogTitle>{t('plugins.approval.title', { name: plugin.name })}</DialogTitle>
          <DialogDescription>{t('plugins.approval.description')}</DialogDescription>
          <p className="text-ui-small text-muted-foreground">
            <span data-user-content>{plugin.version}</span> ·{' '}
            <span data-user-content className="break-all">
              {plugin.source.location}
            </span>
          </p>
        </div>
        {changed && (
          <p role="alert" data-approval-changed className="text-ui-small text-warning-text">
            {t('plugins.approval.changed')}
          </p>
        )}
        <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1" data-approval-content>
          <Executables plugin={plugin} />
          <Names label={t('plugins.approval.skills')} kind="skills" names={plugin.contributions.skills} />
          <Names label={t('plugins.approval.commands')} kind="commands" names={plugin.contributions.commands} />
          <Names label={t('plugins.approval.agents')} kind="agents" names={plugin.contributions.agents} />
        </div>
        <div className="flex shrink-0 justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={working} onClick={onClose}>
            {t('plugins.approval.cancel')}
          </Button>
          <Button size="sm" data-action="approve-plugin" disabled={working} onClick={() => void approve()}>
            {t('plugins.approval.approve')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Executables({ plugin }: { plugin: PluginInfo }) {
  const { t } = useI18n()
  const { hooks, mcpServers, lspServers } = plugin.executables
  if (hooks.length + mcpServers.length + lspServers.length === 0)
    return <p className="text-ui-small text-muted-foreground">{t('plugins.approval.nothingExecutable')}</p>
  return (
    <>
      {hooks.length > 0 && (
        <Group title={t('plugins.approval.hooks')}>
          {hooks.map((hook, index) => (
            <li key={index} data-approval-hook={index} className="flex flex-col gap-1 rounded-lg bg-muted/50 px-3 py-2">
              <div className="flex flex-wrap gap-x-3 text-ui-small text-muted-foreground">
                <span>
                  {t('plugins.approval.event')}:{' '}
                  <span data-user-content className="font-mono text-foreground">
                    {hook.event}
                  </span>
                </span>
                {hook.matcher !== undefined && (
                  <span>
                    {t('plugins.approval.matcher')}:{' '}
                    <span data-user-content className="font-mono text-foreground">
                      {hook.matcher}
                    </span>
                  </span>
                )}
              </div>
              <Command value={hook.command} />
            </li>
          ))}
        </Group>
      )}
      {mcpServers.length > 0 && (
        <Group title={t('plugins.approval.mcpServers')}>
          {mcpServers.map((server) => (
            <li key={server.name} data-approval-mcp={server.name} className="flex flex-col gap-1 rounded-lg bg-muted/50 px-3 py-2">
              <span data-user-content className="font-mono text-ui-small font-medium">
                {server.name}
              </span>
              {server.command !== undefined && <Field label={t('plugins.approval.command')} value={<Command value={server.command} />} />}
              {server.args !== undefined && server.args.length > 0 && <Field label={t('plugins.approval.args')} value={<Lines values={server.args} />} />}
              {server.url !== undefined && <Field label={t('plugins.approval.url')} value={<Command value={server.url} />} />}
              <Field label={t('plugins.approval.envKeys')} value={<Lines values={server.envKeys} />} />
            </li>
          ))}
        </Group>
      )}
      {lspServers.length > 0 && (
        <Group title={t('plugins.approval.lspServers')}>
          {lspServers.map((server) => (
            <li key={server.name} data-approval-lsp={server.name} className="flex flex-col gap-1 rounded-lg bg-muted/50 px-3 py-2">
              <span data-user-content className="font-mono text-ui-small font-medium">
                {server.name}
              </span>
              <Field label={t('plugins.approval.command')} value={<Command value={server.command} />} />
              {server.args !== undefined && server.args.length > 0 && <Field label={t('plugins.approval.args')} value={<Lines values={server.args} />} />}
              <Field label={t('plugins.approval.extensions')} value={<Lines values={server.extensions} inline />} />
            </li>
          ))}
        </Group>
      )}
    </>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  const id = React.useId()
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1.5">
      <h3 id={id} className="text-ui-body font-medium">
        {title}
      </h3>
      <ul className="flex flex-col gap-1.5">{children}</ul>
    </section>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-ui-small text-muted-foreground">{label}</span>
      {value}
    </div>
  )
}

/** 完整命令：换行显示，不截断、不横向滚动。 */
function Command({ value }: { value: string }) {
  return (
    <pre data-user-content data-approval-command className="font-mono text-ui-small break-all whitespace-pre-wrap select-text">
      {value}
    </pre>
  )
}

function Lines({ values, inline = false }: { values: string[]; inline?: boolean }) {
  const { t } = useI18n()
  if (values.length === 0) return <span className="text-ui-small text-muted-foreground">{t('plugins.approval.none')}</span>
  return (
    <pre data-user-content className="font-mono text-ui-small break-all whitespace-pre-wrap select-text">
      {values.join(inline ? ' ' : '\n')}
    </pre>
  )
}

function Names({ label, kind, names }: { label: string; kind: string; names: string[] }) {
  if (names.length === 0) return null
  return (
    <section className="flex flex-col gap-1" data-approval-names={kind}>
      <h3 className="text-ui-body font-medium">{label}</h3>
      <p data-user-content className="font-mono text-ui-small break-all">
        {names.join(', ')}
      </p>
    </section>
  )
}
