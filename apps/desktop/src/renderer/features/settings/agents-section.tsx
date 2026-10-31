// 设置 → Agents 分区（ADR 0014）：当前会话目录可用的子代理定义（内置、用户、项目，同名时 project > user > builtin）与诊断，只读；
// 定义是 Markdown 文件，注明在文件中编辑。没有会话或草稿 Workspace 时只说明定义的位置。
import type { AgentDefinitionInfo, AgentDefinitionSource } from '@coko/protocol'
import { Button } from '@coko/ui'
import { ChevronRightIcon, LoaderCircleIcon } from 'lucide-react'
import * as React from 'react'
import { useChat } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { useAgents, useAgentsStoreApi } from '../conversation/agents-button.tsx'
import { SettingsCard } from './settings-page.tsx'

const SOURCES: readonly AgentDefinitionSource[] = ['builtin', 'user', 'project']

function Definition({ definition }: { definition: AgentDefinitionInfo }) {
  const { t } = useI18n()
  const facts = [
    definition.tools ? t('agents.section.tools', { tools: definition.tools.join(', ') }) : t('agents.section.allTools'),
    definition.model ? t('agents.section.model', { model: definition.model }) : undefined,
    definition.permissionMode ? t('agents.section.permissionMode', { mode: t(`permissions.modes.${definition.permissionMode}`) }) : undefined,
    t('agents.section.maxTurns', { count: definition.maxTurns }),
  ].filter((fact): fact is string => fact !== undefined)
  return (
    <div
      data-agent-definition={definition.name}
      data-source={definition.source}
      className="flex flex-col gap-1 px-4 py-3 not-last:border-b-hairline not-last:border-border"
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-ui-body font-medium">{definition.name}</span>
        <span className="text-ui-small text-muted-foreground">{t(`agents.section.source.${definition.source}`)}</span>
      </div>
      {definition.description !== '' && (
        <p data-user-content className="text-ui-body break-words">
          {definition.description}
        </p>
      )}
      <p className="text-ui-small break-words text-muted-foreground">{facts.join(' · ')}</p>
      {definition.path !== undefined && (
        <p data-user-content className="font-mono text-ui-small break-all text-muted-foreground select-text">
          {definition.path}
        </p>
      )}
    </div>
  )
}

export function AgentsSection() {
  const { t } = useI18n()
  const store = useAgentsStoreApi()
  const workspaceId = useChat((s) => s.sessions.find((x) => x.id === s.activeSessionId)?.workspaceId ?? s.draftWorkspaceId ?? undefined)
  const view = useAgents((s) => (workspaceId === undefined ? undefined : s.definitions[workspaceId]))
  const load = React.useCallback(() => (workspaceId === undefined ? Promise.resolve() : store.getState().loadDefinitions(workspaceId)), [store, workspaceId])
  React.useEffect(() => void load(), [load])
  const response = view?.response
  return (
    <section aria-labelledby="settings-agents" className="flex flex-col gap-3" data-agents-section>
      <div className="flex min-w-0 flex-col">
        <h2 id="settings-agents" className="text-ui-body-lg font-medium">
          {t('agents.settings')}
        </h2>
        <p className="text-ui-small text-muted-foreground">{t('agents.section.description')}</p>
      </div>
      <p data-slot="agents-edit-hint" className="text-ui-small break-words text-muted-foreground">
        {t('agents.section.editHint', { user: '~/.coko/agents/*.md', project: '.coko/agents/*.md' })}
      </p>
      {workspaceId === undefined && <p className="text-ui-body text-muted-foreground">{t('agents.section.noWorkspace')}</p>}
      {view?.status === 'loading' && !response && (
        <div className="flex justify-center py-6" aria-label={t('agents.tabView.loading')}>
          <LoaderCircleIcon aria-hidden className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none" />
        </div>
      )}
      {view?.status === 'error' && !response && (
        <div className="flex items-center gap-2" role="alert">
          <p className="text-ui-body text-muted-foreground">{t('agents.section.loadFailed')}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            {t('agents.section.retry')}
          </Button>
        </div>
      )}
      {response && (
        <>
          {SOURCES.map((source) => {
            const definitions = response.definitions.filter((d) => d.source === source)
            if (definitions.length === 0) return null
            return (
              <div key={source} className="flex flex-col gap-2" data-agents-source={source}>
                <h3 className="text-ui-body font-medium">{t(`agents.section.source.${source}`)}</h3>
                <SettingsCard className="flex flex-col">
                  {definitions.map((definition) => (
                    <Definition key={`${definition.source}:${definition.name}`} definition={definition} />
                  ))}
                </SettingsCard>
              </div>
            )
          })}
          {response.diagnostics.length > 0 && (
            <details data-agents-diagnostics={response.diagnostics.length} className="group/diagnostics rounded-lg bg-muted/50">
              <summary className="flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-2 text-ui-small font-medium select-none focus-ring [&::-webkit-details-marker]:hidden">
                <ChevronRightIcon aria-hidden className="size-4 shrink-0 transition-transform group-open/diagnostics:rotate-90 motion-reduce:transition-none" />
                {t('agents.section.diagnostics', { count: response.diagnostics.length })}
              </summary>
              <ul className="flex flex-col gap-1.5 px-3 pb-2">
                {response.diagnostics.map((d, index) => (
                  <li key={index} className="flex flex-col" data-diagnostic={d.code}>
                    <span className="font-mono text-ui-small">{d.code}</span>
                    {d.path !== undefined && (
                      <span data-user-content className="font-mono text-ui-small break-all text-muted-foreground">
                        {d.path}
                      </span>
                    )}
                    <span data-user-content className="font-mono text-ui-small break-all text-muted-foreground">
                      {d.message}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  )
}
