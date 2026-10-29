import { createTranslator, type Locale, type MessageKey } from '@coko/i18n'
import type { ResourceDiagnostic } from '@coko/protocol'
import { cn, toast, ToggleGroup, ToggleGroupItem } from '@coko/ui'
import { ChevronDownIcon, MoonIcon, SunIcon } from 'lucide-react'
import * as React from 'react'
import { useStore } from 'zustand'
import type { Theme } from '../../app/appearance-store.ts'
import { useChat } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { usePreferences } from '../../app/settings.tsx'
import { configStore } from '../../stores/config-store.ts'
import { CapabilityToggle } from './capability-toggle.tsx'
import { SettingsCard, SettingsRow } from './settings-dialog.tsx'

export function GeneralSection({ theme }: { theme: Theme }) {
  const { t, locale } = useI18n()
  const preferences = usePreferences()
  return (
    <section aria-labelledby="settings-general" className="flex flex-col gap-3">
      <h2 id="settings-general" className="text-ui-body-lg font-medium">
        {t('settings.general')}
      </h2>
      <SettingsCard>
        <SettingsRow label={t('appearance.theme')}>
          <ToggleGroup
            type="single"
            aria-label={t('appearance.theme')}
            value={theme}
            onValueChange={(value) => value && void preferences.setTheme(value as Theme)}
          >
            <ToggleGroupItem value="light" data-theme-option="light">
              <SunIcon />
              {t('appearance.light')}
            </ToggleGroupItem>
            <ToggleGroupItem value="dark" data-theme-option="dark">
              <MoonIcon />
              {t('appearance.dark')}
            </ToggleGroupItem>
          </ToggleGroup>
        </SettingsRow>
        <SettingsRow label={t('appearance.language')}>
          <ToggleGroup
            type="single"
            aria-label={t('appearance.language')}
            value={locale}
            onValueChange={(value) => {
              if (!value || value === locale) return
              const next = value as Locale
              void preferences.setLocale(next)
              toast.success(createTranslator(next)('appearance.localeChanged'))
            }}
          >
            {/* 语言名始终以其本身的语言显示。 */}
            <ToggleGroupItem value="zh" lang="zh-CN">
              {t('locale.zh')}
            </ToggleGroupItem>
            <ToggleGroupItem value="en" lang="en">
              {t('locale.en')}
            </ToggleGroupItem>
          </ToggleGroup>
        </SettingsRow>
        <ProjectSettingsRow />
      </SettingsCard>
      <ContextSwitches />
    </section>
  )
}

/** 指令文件、自动压缩与时间裁剪的全局开关。 */
function ContextSwitches() {
  const { t } = useI18n()
  const activeWorkspaceId = useChat((s) => s.sessions.find((x) => x.id === s.activeSessionId)?.workspaceId)
  const draftWorkspaceId = useChat((s) => s.draftWorkspaceId)
  const workspaceId = activeWorkspaceId ?? draftWorkspaceId ?? undefined
  return (
    <div className="flex flex-col gap-2">
      <h3 id="settings-context" className="text-ui-body font-medium">
        {t('config.capabilities.title')}
      </h3>
      <SettingsCard aria-labelledby="settings-context" role="group">
        <CapabilityToggle name="instructions.enabled" workspaceId={workspaceId} />
        <CapabilityToggle name="context.autoCompact" workspaceId={workspaceId} />
        <CapabilityToggle name="context.trimOldToolResults" workspaceId={workspaceId} />
      </SettingsCard>
    </div>
  )
}

const DIAGNOSTIC_TITLES: Record<string, MessageKey> = {
  'unknown-key': 'config.diagnostics.unknown-key',
  'invalid-value': 'config.diagnostics.invalid-value',
  'project-cannot-grant': 'config.diagnostics.project-cannot-grant',
  'invalid-json': 'config.diagnostics.invalid-json',
  'read-failed': 'config.diagnostics.read-failed',
}

/** 当前会话所在 Workspace 的 .coko/settings.json：路径、是否存在与诊断数，展开看每条诊断。 */
function ProjectSettingsRow() {
  const { t } = useI18n()
  const activeWorkspaceId = useChat((s) => s.sessions.find((x) => x.id === s.activeSessionId)?.workspaceId)
  const draftWorkspaceId = useChat((s) => s.draftWorkspaceId)
  const workspaceId = activeWorkspaceId ?? draftWorkspaceId ?? undefined
  const status = useStore(configStore, (s) => s.status)
  const loadedFor = useStore(configStore, (s) => s.workspaceId)
  const project = useStore(configStore, (s) => s.config?.project)
  const [expanded, setExpanded] = React.useState(false)
  const listId = React.useId()

  React.useEffect(() => {
    if (workspaceId !== undefined) void configStore.getState().load(workspaceId)
  }, [workspaceId])

  const current = workspaceId !== undefined && loadedFor === workspaceId ? project : undefined
  const diagnostics = current?.diagnostics ?? []
  let summary: React.ReactNode
  if (workspaceId === undefined) summary = <span className="text-ui-small text-muted-foreground">{t('config.project.noWorkspace')}</span>
  else if (!current)
    summary = <span className="text-ui-small text-muted-foreground">{status === 'error' ? t('config.project.loadFailed') : t('config.project.loading')}</span>
  else if (diagnostics.length > 0)
    summary = (
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-label={t('config.project.showIssues')}
        data-project-diagnostics={diagnostics.length}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-ui-small text-destructive hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
        onClick={() => setExpanded((value) => !value)}
      >
        {t('config.project.issues', { count: diagnostics.length })}
        <ChevronDownIcon className={cn('size-3.5 transition-transform motion-reduce:transition-none', expanded && 'rotate-180')} />
      </button>
    )
  else
    summary = (
      <span className="text-ui-small text-muted-foreground" data-project-diagnostics={0}>
        {current.exists ? t('config.project.noIssues') : t('config.project.missing')}
      </span>
    )

  return (
    <div className="flex flex-col gap-2 px-4 py-3 not-last:border-b-hairline not-last:border-border" data-project-settings={current?.path}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-ui-body">{t('config.project.label')}</span>
          {current && (
            <code data-user-content className="font-mono text-ui-small break-all text-muted-foreground">
              {current.path}
            </code>
          )}
          <span className="text-ui-small text-muted-foreground">{t('config.project.hint')}</span>
        </div>
        {summary}
      </div>
      {expanded && diagnostics.length > 0 && (
        <ul id={listId} className="flex flex-col gap-1.5 rounded-lg bg-muted/50 px-3 py-2">
          {diagnostics.map((d, index) => (
            <DiagnosticItem key={index} diagnostic={d} />
          ))}
        </ul>
      )}
    </div>
  )
}

function DiagnosticItem({ diagnostic }: { diagnostic: ResourceDiagnostic }) {
  const { t } = useI18n()
  return (
    <li className="flex flex-col" data-diagnostic={diagnostic.code}>
      <span className="text-ui-small">{t(DIAGNOSTIC_TITLES[diagnostic.code] ?? 'config.diagnostics.other')}</span>
      <span data-user-content className="font-mono text-ui-small break-all text-muted-foreground">
        {diagnostic.message}
      </span>
    </li>
  )
}
