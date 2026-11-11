import { formatPermissionRule, parsePermissionRule, type PermissionRule, type StandardPermissionMode } from '@coko/protocol'
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Input,
  toast,
  ToggleGroup,
  ToggleGroupItem,
} from '@coko/ui'
import { IconChevronDown, IconPlus, IconTrash } from '@tabler/icons-react'
import * as React from 'react'
import { useChat, useChatActions, useActiveWorkspaceId, useLists } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { IconButton } from '../../app/icon-button.tsx'
import { useSettings, useSettingsActions } from '../../app/settings.tsx'
import { sessionRules } from '../../stores/chat-store.ts'
import type { PermissionsChange, SaveSettingResult } from '../../stores/settings-store.ts'
import { MODE_ICONS, PERMISSION_MODES } from '../conversation/mode-picker.tsx'
import { SettingsCard, SettingsRow } from './settings-page.tsx'

const BEHAVIORS: PermissionRule['behavior'][] = ['allow', 'ask', 'deny']
/** 保存规则的结果：Sidecar 拒绝未知工具名时带该名字。 */
type RuleSaveOutcome = { saved: boolean; unknownTool?: string }
const ruleKey = (rule: PermissionRule) => `${rule.behavior}:${formatPermissionRule(rule)}`
const sameRule = (a: PermissionRule, b: PermissionRule) => ruleKey(a) === ruleKey(b)

/**
 * 设置页的 Permissions 分区：新会话的默认模式；全局与当前 Workspace 的规则（增删）；该 Workspace 项目设置中的规则（只读，标出来源文件）；
 * 当前会话的规则（只读可删）。
 */
export function PermissionsSection() {
  const { t } = useI18n()
  const permissions = useSettings((s) => s.permissions)
  const { loadPermissions, savePermissions } = useSettingsActions()
  const workspaceId = useActiveWorkspaceId()
  const workspace = useLists((s) => s.workspaces.find((w) => w.id === workspaceId))
  const conversation = useChat((s) => (s.activeSessionId === null ? undefined : s.conversations[s.activeSessionId]))
  const { removeSessionRule } = useChatActions()
  const ownRules = React.useMemo(() => (conversation ? sessionRules(conversation.entries) : []), [conversation])

  React.useEffect(() => {
    void loadPermissions(workspaceId)
  }, [loadPermissions, workspaceId])

  /** 保存一项；未知工具名交给规则编辑器行内提示（返回该工具名），其余失败以 Toast 提示。 */
  const save = async (change: PermissionsChange): Promise<RuleSaveOutcome> => {
    const result: SaveSettingResult = await savePermissions(change)
    if (result.status === 'saved') toast.success(t('permissions.saved'))
    else if (result.status === 'conflict') toast.error(t('permissions.conflict'))
    else if (result.error.details?.reason === 'unknown-tool') return { saved: false, unknownTool: String(result.error.details.tool) }
    else toast.error(t('errors.permissionsFailed'))
    return { saved: result.status === 'saved' }
  }

  const defaultMode = permissions?.defaultMode.value ?? 'default'
  const DefaultIcon = MODE_ICONS[defaultMode]
  const workspaceRules = permissions?.workspace?.workspaceId === workspaceId ? permissions?.workspace?.rules : undefined
  const projectRules = permissions?.project?.workspaceId === workspaceId ? permissions?.project : undefined

  return (
    <section aria-labelledby="settings-permissions" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="settings-permissions" className="text-ui-body-lg font-medium">
          {t('settings.permissions')}
        </h2>
        <p className="text-ui-small text-muted-foreground">{t('permissions.description')}</p>
      </div>

      {permissions === null ? (
        <p className="text-ui-body text-muted-foreground">{t('permissions.loadFailed')}</p>
      ) : (
        <>
          <SettingsCard>
            <SettingsRow label={t('permissions.defaultMode')}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    data-default-mode={defaultMode}
                    aria-label={`${t('permissions.defaultMode')}: ${t(`permissions.modes.${defaultMode}`)}`}
                    className={cn(defaultMode === 'full-access' && 'text-destructive [&_svg]:text-destructive')}
                  >
                    <DefaultIcon />
                    {t(`permissions.modes.${defaultMode}`)}
                    <IconChevronDown aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80">
                  <DropdownMenuRadioGroup
                    value={defaultMode}
                    onValueChange={(value) => void save({ target: 'defaultMode', value: value as StandardPermissionMode })}
                  >
                    {PERMISSION_MODES.map((mode) => (
                      <DropdownMenuRadioItem
                        key={mode}
                        value={mode}
                        data-mode={mode}
                        className={cn('h-auto py-1.5', mode === 'full-access' && 'text-destructive')}
                      >
                        <span className="flex min-w-0 flex-col">
                          <span>{t(`permissions.modes.${mode}`)}</span>
                          <span className="text-ui-small text-muted-foreground">{t(`permissions.modeDescriptions.${mode}`)}</span>
                        </span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </SettingsRow>
          </SettingsCard>

          <RuleEditor id="global" title={t('permissions.global')} rules={permissions.global.rules} onChange={(rules) => save({ target: 'global', rules })} />

          {workspaceId !== undefined && workspaceRules !== undefined ? (
            <RuleEditor
              id="workspace"
              title={t('permissions.workspace', { name: workspace?.name ?? '' })}
              rules={workspaceRules}
              onChange={(rules) => save({ target: 'workspace', workspaceId, rules })}
            />
          ) : (
            <p className="text-ui-small text-muted-foreground">{t('permissions.noWorkspace')}</p>
          )}

          {projectRules !== undefined && (
            // project 作用域（ADR 0008）：来自 .coko/settings.json 的 deny / ask，只读，没有删除入口。
            <RuleList
              id="project"
              title={t('config.projectRules.title')}
              hint={t('config.projectRules.hint', { path: projectRules.path })}
              rules={projectRules.rules}
            />
          )}

          {conversation && (
            <RuleList
              id="session"
              title={t('permissions.session')}
              hint={t('permissions.sessionHint')}
              rules={ownRules}
              onRemove={async (rule) => {
                if (await removeSessionRule(rule)) toast.success(t('permissions.saved'))
              }}
            />
          )}
        </>
      )}
    </section>
  )
}

function RuleList({
  id,
  title,
  hint,
  rules,
  onRemove,
  children,
}: {
  id: string
  title: string
  hint?: string
  rules: readonly PermissionRule[]
  /** 省略时只读（没有删除入口）。 */
  onRemove?: (rule: PermissionRule) => void | Promise<unknown>
  children?: React.ReactNode
}) {
  const { t } = useI18n()
  return (
    <div className="flex flex-col gap-2" data-rule-list={id}>
      <div className="flex flex-col">
        <h3 id={`permissions-${id}`} className="text-ui-body font-medium">
          {title}
        </h3>
        {hint !== undefined && <p className="text-ui-small text-muted-foreground">{hint}</p>}
      </div>
      <SettingsCard>
        {rules.length === 0 ? (
          <p className="px-4 py-3 text-ui-body text-muted-foreground">{t('permissions.empty')}</p>
        ) : (
          <ul aria-labelledby={`permissions-${id}`}>
            {BEHAVIORS.flatMap((behavior) =>
              rules
                .filter((rule) => rule.behavior === behavior)
                .map((rule) => {
                  const text = formatPermissionRule(rule)
                  return (
                    <li
                      key={ruleKey(rule)}
                      data-rule={text}
                      data-behavior={behavior}
                      className="flex items-center gap-3 px-4 py-2 not-last:border-b-hairline not-last:border-border"
                    >
                      <span className={cn('w-12 shrink-0 text-ui-small text-muted-foreground', behavior === 'deny' && 'text-destructive')}>
                        {t(`permissions.behaviors.${behavior}`)}
                      </span>
                      <code data-user-content className="min-w-0 flex-1 font-mono text-ui-body break-all">
                        {text}
                      </code>
                      {onRemove && (
                        <IconButton label={t('permissions.remove', { rule: text })} onClick={() => void onRemove(rule)}>
                          <IconTrash aria-hidden />
                        </IconButton>
                      )}
                    </li>
                  )
                }),
            )}
          </ul>
        )}
        {children}
      </SettingsCard>
    </div>
  )
}

function RuleEditor({
  id,
  title,
  rules,
  onChange,
}: {
  id: string
  title: string
  rules: readonly PermissionRule[]
  onChange: (rules: PermissionRule[]) => Promise<RuleSaveOutcome>
}) {
  const { t } = useI18n()
  const [behavior, setBehavior] = React.useState<PermissionRule['behavior']>('allow')
  const [text, setText] = React.useState('')
  const [error, setError] = React.useState<string | undefined>()
  const [busy, setBusy] = React.useState(false)
  const inputId = React.useId()

  const change = async (next: PermissionRule[]) => {
    setBusy(true)
    try {
      return await onChange(next)
    } finally {
      setBusy(false)
    }
  }
  const add = async () => {
    const parsed = parsePermissionRule(text)
    if (!parsed) return setError(t('permissions.invalidRule'))
    const rule: PermissionRule = { behavior, ...parsed }
    if (rules.some((r) => sameRule(r, rule))) return setError(t('permissions.duplicateRule'))
    // Sidecar 把工具名归一为规范名（bash → Bash），未知工具名拒绝。
    const outcome = await change([...rules, rule])
    if (outcome.saved) setText('')
    else if (outcome.unknownTool !== undefined) setError(t('permissions.unknownTool', { tool: outcome.unknownTool }))
  }

  return (
    <RuleList id={id} title={title} rules={rules} onRemove={(rule) => change(rules.filter((r) => !sameRule(r, rule)))}>
      <form
        className="flex flex-wrap items-start gap-2 border-t-hairline border-border px-4 py-3"
        onSubmit={(event) => {
          event.preventDefault()
          void add()
        }}
      >
        <ToggleGroup
          type="single"
          aria-label={t('permissions.behavior')}
          value={behavior}
          onValueChange={(value) => value && setBehavior(value as PermissionRule['behavior'])}
        >
          {BEHAVIORS.map((b) => (
            <ToggleGroupItem key={b} value={b} data-behavior-option={b}>
              {t(`permissions.behaviors.${b}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <Input
            id={inputId}
            aria-label={t('permissions.rule')}
            aria-invalid={error !== undefined || undefined}
            aria-describedby={error ? `${inputId}-error` : undefined}
            placeholder={t('permissions.rulePlaceholder')}
            className="font-mono"
            value={text}
            disabled={busy}
            onChange={(event) => {
              setText(event.target.value)
              setError(undefined)
            }}
          />
          {error !== undefined && (
            <p id={`${inputId}-error`} role="alert" className="text-ui-small text-destructive">
              {error}
            </p>
          )}
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={busy || text.trim() === ''}>
          <IconPlus aria-hidden />
          {t('permissions.add')}
        </Button>
      </form>
    </RuleList>
  )
}
