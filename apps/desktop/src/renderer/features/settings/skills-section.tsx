// Skills & Commands 分区：当前工作区的 Skill 与命令（来源、路径、启停、声明的工具（不授予）、诊断）。数据来自 GET /api/skills 与
// GET /api/commands；启停写全局配置的 skills.enabled、skills.disabled 与 commands.disabled（PUT /api/config，带回其他全局键）。文件不被改写（ADR 0009）。
import type { MessageKey } from '@coko/i18n'
import type { CommandInfo, ResourceDiagnostic, SkillInfo } from '@coko/protocol'
import { Checkbox, toast } from '@coko/ui'
import * as React from 'react'
import { useStore } from 'zustand'
import { useChat } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { skillsStore } from '../../stores/skills-store.ts'
import { CapabilityToggle } from './capability-toggle.tsx'
import { SettingsCard } from './settings-dialog.tsx'

const DIAGNOSTIC_KEYS: Record<string, MessageKey> = {
  'invalid-frontmatter': 'skills.diagnostics.invalid-frontmatter',
  'invalid-name': 'skills.diagnostics.invalid-name',
  'name-mismatch': 'skills.diagnostics.name-mismatch',
  'missing-description': 'skills.diagnostics.missing-description',
  'description-too-long': 'skills.diagnostics.description-too-long',
  'invalid-value': 'skills.diagnostics.invalid-value',
  'empty-template': 'skills.diagnostics.empty-template',
  'read-failed': 'skills.diagnostics.read-failed',
  shadowed: 'skills.diagnostics.shadowed',
  'skill-outside-workspace': 'skills.diagnostics.skill-outside-workspace',
}

/** 失败时 toast；进行中禁用控件。 */
function useSaving() {
  const { t } = useI18n()
  const [busy, setBusy] = React.useState(false)
  const run = async (task: () => Promise<void>) => {
    setBusy(true)
    try {
      await task()
    } catch {
      toast.error(t('skills.saveFailed'))
    } finally {
      setBusy(false)
    }
  }
  return { busy, run }
}

export function SkillsSection() {
  const { t } = useI18n()
  const activeWorkspaceId = useChat((s) => s.sessions.find((x) => x.id === s.activeSessionId)?.workspaceId)
  const draftWorkspaceId = useChat((s) => s.draftWorkspaceId)
  const workspaceId = activeWorkspaceId ?? draftWorkspaceId ?? undefined
  const status = useStore(skillsStore, (s) => s.status)
  const loadedFor = useStore(skillsStore, (s) => s.workspaceId)
  const skills = useStore(skillsStore, (s) => s.skills)
  const commands = useStore(skillsStore, (s) => s.commands)
  const diagnostics = useStore(skillsStore, (s) => s.diagnostics)

  React.useEffect(() => {
    void skillsStore.getState().load(workspaceId)
  }, [workspaceId])

  const current = loadedFor === (workspaceId ?? null)
  return (
    <section aria-labelledby="settings-skills" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="settings-skills" className="text-ui-body-lg font-medium">
          {t('skills.title')}
        </h2>
        <p className="text-ui-small text-muted-foreground">{t('skills.description')}</p>
      </div>
      {workspaceId === undefined ? (
        <p className="text-ui-body text-muted-foreground">{t('skills.noWorkspace')}</p>
      ) : status === 'error' ? (
        <p className="text-ui-body text-muted-foreground">{t('skills.loadFailed')}</p>
      ) : (
        <>
          <SkillsToggle />
          <Group id="skills-list" title={t('skills.skillsHeading')} empty={t('skills.emptySkills')} ready={current && status === 'ready'}>
            {current && skills.map((skill) => <SkillRow key={skill.path} skill={skill} />)}
          </Group>
          <SettingsCard>
            <CapabilityToggle name="commands.enabled" workspaceId={workspaceId} />
          </SettingsCard>
          <Group id="commands-list" title={t('skills.commandsHeading')} empty={t('skills.emptyCommands')} ready={current && status === 'ready'}>
            {current && commands.map((command) => <CommandRow key={`${command.source}:${command.name}`} command={command} />)}
          </Group>
          {current && diagnostics.length > 0 && <Diagnostics diagnostics={diagnostics} />}
        </>
      )}
    </section>
  )
}

function Group({ id, title, empty, ready, children }: { id: string; title: string; empty: string; ready: boolean; children: React.ReactNode }) {
  const items = React.Children.toArray(children)
  return (
    <div className="flex flex-col gap-2" data-list={id}>
      <h3 id={id} className="text-ui-body font-medium">
        {title}
      </h3>
      <SettingsCard>
        {items.length === 0 ? (
          <p className="px-4 py-3 text-ui-body text-muted-foreground">{ready ? empty : '\u00a0'}</p>
        ) : (
          <ul aria-labelledby={id}>{items}</ul>
        )}
      </SettingsCard>
    </div>
  )
}

/** 全局 skills.enabled；有效值被项目设置关闭时注明。 */
function SkillsToggle() {
  const { t } = useI18n()
  const config = useStore(skillsStore, (s) => s.config)
  const { busy, run } = useSaving()
  const id = React.useId()
  const global = config ? config.global.skills?.enabled !== false : undefined
  const blockedByProject = config !== null && global === true && !config.effective.skills.enabled
  return (
    <SettingsCard>
      <div className="flex items-start gap-3 px-4 py-3">
        <Checkbox
          id={id}
          className="mt-0.5"
          data-skills-enabled={global === undefined ? undefined : String(global)}
          checked={global ?? false}
          disabled={global === undefined || busy}
          onCheckedChange={(checked) => void run(() => skillsStore.getState().setSkillsEnabled(checked === true))}
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <label htmlFor={id} className="text-ui-body">
            {t('skills.enabled')}
          </label>
          <span className="text-ui-small text-muted-foreground">{t('skills.enabledHint')}</span>
          {blockedByProject && <span className="text-ui-small text-destructive">{t('skills.disabledByProject')}</span>}
        </div>
      </div>
    </SettingsCard>
  )
}

function SkillRow({ skill }: { skill: SkillInfo }) {
  const { t } = useI18n()
  const config = useStore(skillsStore, (s) => s.config)
  const { busy, run } = useSaving()
  const globallyOn = !(config?.global.skills?.disabled ?? []).includes(skill.name)
  const byProject = (config?.project?.values.skills?.disabled ?? []).includes(skill.name)
  return (
    <Row
      data={{ 'data-skill': skill.name, 'data-scope': skill.scope, 'data-enabled': String(skill.enabled) }}
      name={skill.name}
      label={t(`skills.scope.${skill.scope}`)}
      description={skill.description}
      path={skill.path}
      checked={globallyOn}
      disabled={busy || config === null}
      onToggle={(enabled) => void run(() => skillsStore.getState().setSkillEnabled(skill.name, enabled))}
    >
      {skill.disableModelInvocation && <span className="text-ui-small text-muted-foreground">{t('skills.explicitOnly', { name: skill.name })}</span>}
      {skill.allowedTools.length > 0 && (
        <span className="text-ui-small text-muted-foreground" data-allowed-tools={skill.allowedTools.join(' ')}>
          {t('skills.declaredTools', { tools: skill.allowedTools.join(', ') })} · {t('skills.declaredToolsHint')}
        </span>
      )}
      {byProject && <span className="text-ui-small text-destructive">{t('skills.itemDisabledByProject')}</span>}
    </Row>
  )
}

function CommandRow({ command }: { command: CommandInfo }) {
  const { t } = useI18n()
  const config = useStore(skillsStore, (s) => s.config)
  const { busy, run } = useSaving()
  const globallyOn = !(config?.global.commands?.disabled ?? []).includes(command.name)
  return (
    <Row
      data={{ 'data-command': command.name, 'data-source': command.source, 'data-enabled': String(command.enabled) }}
      name={`/${command.name}`}
      label={t(`commands.source.${command.source}`)}
      description={command.description}
      path={command.path}
      checked={globallyOn}
      disabled={busy || config === null}
      onToggle={(enabled) => void run(() => skillsStore.getState().setCommandEnabled(command.name, enabled))}
    />
  )
}

function Row({
  data,
  name,
  label,
  description,
  path,
  checked,
  disabled,
  onToggle,
  children,
}: {
  data: Record<string, string>
  name: string
  label: string
  description: string
  path?: string | undefined
  checked: boolean
  disabled: boolean
  onToggle: (enabled: boolean) => void
  children?: React.ReactNode
}) {
  const { t } = useI18n()
  return (
    <li {...data} className="flex items-start gap-3 px-4 py-3 not-last:border-b-hairline not-last:border-border">
      <Checkbox
        className="mt-0.5"
        aria-label={t('skills.toggle', { name })}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onToggle(value === true)}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span data-user-content className="font-mono text-ui-body font-medium break-all">
            {name}
          </span>
          <span className="text-ui-small text-muted-foreground">{label}</span>
        </div>
        <p data-user-content className="text-ui-small break-words">
          {description}
        </p>
        {path !== undefined && (
          <code data-user-content data-path className="font-mono text-ui-small break-all text-muted-foreground">
            {path}
          </code>
        )}
        {children}
      </div>
    </li>
  )
}

function Diagnostics({ diagnostics }: { diagnostics: ResourceDiagnostic[] }) {
  const { t } = useI18n()
  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-muted/50 px-3 py-2" data-skills-diagnostics={diagnostics.length}>
      <span className="text-ui-small font-medium">{t('skills.diagnostics.title')}</span>
      <ul className="flex flex-col gap-1.5">
        {diagnostics.map((d, index) => (
          <li key={index} className="flex flex-col" data-diagnostic={d.code} data-source={d.source}>
            <span className="text-ui-small">{t(DIAGNOSTIC_KEYS[d.code] ?? 'skills.diagnostics.other')}</span>
            {d.path !== undefined && (
              <code data-user-content className="font-mono text-ui-small break-all text-muted-foreground">
                {d.path}
              </code>
            )}
            <span data-user-content className="text-ui-small break-words text-muted-foreground">
              {d.message}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
