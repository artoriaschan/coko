import type { MessageKey } from '@coko/i18n'
import { DiffBlock, ToolCard, ToolOutput } from '@coko/ui'
import { FilePenIcon, FilePlusIcon, FileTextIcon, FolderSearchIcon, FolderTreeIcon, SearchIcon, TerminalIcon, WrenchIcon } from 'lucide-react'
import type * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import { resultText, type TimelineItem } from './timeline.ts'

type ToolItem = Extract<TimelineItem, { kind: 'tool' }>

interface ToolView {
  icon: React.ReactNode
  title: MessageKey
  /** 摘要使用的参数字段，保持原文。 */
  summary: (args: Record<string, unknown>) => string | undefined
  body: (item: ToolItem, args: Record<string, unknown>) => React.ReactNode
  /** 默认展开：命令输出与 diff 是主要信息。 */
  expanded?: boolean
}

const str = (value: unknown) => (typeof value === 'string' ? value : undefined)
const output = (item: ToolItem) => item.result?.text ?? resultText(item.live?.partialResult)

function TextBody({ text }: { text: string }) {
  const { t } = useI18n()
  return <ToolOutput>{text === '' ? t('tool.noOutput') : text}</ToolOutput>
}

/** 按工具名分发的专属展示；未登记的工具使用通用展示。 */
const VIEWS: Record<string, ToolView> = {
  bash: {
    icon: <TerminalIcon />,
    title: 'tool.bash',
    summary: (a) => str(a.command),
    body: (item) => <TextBody text={output(item)} />,
    expanded: true,
  },
  read: { icon: <FileTextIcon />, title: 'tool.read', summary: (a) => str(a.path), body: (item) => <TextBody text={output(item)} /> },
  write: {
    icon: <FilePlusIcon />,
    title: 'tool.write',
    summary: (a) => str(a.path),
    body: (item, a) => (item.result?.isError ? <TextBody text={output(item)} /> : <ToolOutput>{str(a.content) ?? ''}</ToolOutput>),
  },
  edit: {
    icon: <FilePenIcon />,
    title: 'tool.edit',
    summary: (a) => str(a.path),
    body: (item) => {
      const diff = str((item.result?.details as { diff?: unknown } | undefined)?.diff)
      return diff && !item.result?.isError ? <DiffBlock diff={diff} /> : <TextBody text={output(item)} />
    },
    expanded: true,
  },
  grep: { icon: <SearchIcon />, title: 'tool.grep', summary: (a) => str(a.pattern), body: (item) => <TextBody text={output(item)} /> },
  find: { icon: <FolderSearchIcon />, title: 'tool.find', summary: (a) => str(a.pattern), body: (item) => <TextBody text={output(item)} /> },
  ls: { icon: <FolderTreeIcon />, title: 'tool.ls', summary: (a) => str(a.path) ?? '.', body: (item) => <TextBody text={output(item)} /> },
}

const json = (value: unknown) => {
  if (value === undefined) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/** 未知工具：工具名为摘要，参数与结果按原样展示。 */
function GenericBody({ item }: { item: ToolItem }) {
  const { t } = useI18n()
  const result = item.result ? (item.result.text !== '' ? item.result.text : json(item.result.details)) : resultText(item.live?.partialResult)
  return (
    <div className="flex flex-col">
      <p className="px-3 pt-2 text-ui-small text-muted-foreground">{t('tool.arguments')}</p>
      <ToolOutput>{json(item.call.arguments)}</ToolOutput>
      {(item.result !== null || item.live?.partialResult !== undefined) && (
        <>
          <p className="border-t-hairline border-border px-3 pt-2 text-ui-small text-muted-foreground">{t('tool.result')}</p>
          <ToolOutput>{result === '' ? t('tool.noOutput') : result}</ToolOutput>
        </>
      )}
    </div>
  )
}

type SandboxModeKey = 'read-only' | 'workspace-write' | 'danger-full-access'

/** bash 结果 details 中的沙箱拒绝（BashToolDetails.sandbox）。 */
function sandboxDenial(item: ToolItem): SandboxModeKey | undefined {
  const sandbox = (item.result?.details as { sandbox?: { mode?: unknown; denied?: unknown } } | undefined)?.sandbox
  return sandbox?.denied === true && typeof sandbox.mode === 'string' ? (sandbox.mode as SandboxModeKey) : undefined
}

/** 标题行的元信息：沙箱拒绝与已结束审批的决定。 */
function ToolMeta({ item }: { item: ToolItem }) {
  const { t } = useI18n()
  const denied = sandboxDenial(item)
  return (
    <>
      {denied && (
        <span data-sandbox-denied={denied} className="max-w-60 shrink truncate text-ui-small text-destructive">
          {t('sandbox.denied', { mode: t(`sandbox.shortModes.${denied}`) })}
        </span>
      )}
      <ApprovalMeta item={item} />
    </>
  )
}

/** 已结束审批的决定，显示在工具卡标题行。 */
function ApprovalMeta({ item }: { item: ToolItem }) {
  const { t } = useI18n()
  const decision = item.approval?.decision
  if (!decision) return null
  const target = item.approval?.request.kind === 'escalation' ? item.approval.request.targetMode : undefined
  let label: string
  switch (decision.outcome) {
    case 'allowed':
      label = target
        ? t('approval.allowedWithMode', { mode: t(`sandbox.shortModes.${target}`) })
        : decision.scope === 'session'
          ? t('approval.allowedSession')
          : decision.scope === 'workspace'
            ? t('approval.allowedWorkspace')
            : decision.scope === 'global'
              ? t('approval.allowedGlobal')
              : t('approval.allowedOnce')
      break
    case 'denied':
      label = decision.feedback ? t('approval.deniedWithFeedback', { feedback: decision.feedback }) : t('approval.denied')
      break
    default:
      label = t(`approval.${decision.outcome}`)
  }
  return (
    <span data-approval-outcome={decision.outcome} className="max-w-60 shrink truncate text-ui-small text-muted-foreground" title={label}>
      {label}
    </span>
  )
}

export function ToolCardView({ item }: { item: ToolItem }) {
  const { t } = useI18n()
  const args = item.call.arguments && typeof item.call.arguments === 'object' ? (item.call.arguments as Record<string, unknown>) : {}
  const view = VIEWS[item.call.name]
  const statusLabel = t(`tool.${item.status}`)
  if (!view) {
    return (
      <ToolCard
        data-tool={item.call.name}
        icon={<WrenchIcon />}
        title={t('tool.unknown')}
        summary={item.call.name}
        status={item.status}
        statusLabel={statusLabel}
        meta={<ToolMeta item={item} />}
        defaultExpanded={item.status === 'error'}
      >
        <GenericBody item={item} />
      </ToolCard>
    )
  }
  const hasBody = item.result !== null || item.live?.partialResult !== undefined || item.call.name === 'write'
  return (
    <ToolCard
      data-tool={item.call.name}
      icon={view.icon}
      title={t(view.title)}
      summary={view.summary(args)}
      status={item.status}
      statusLabel={statusLabel}
      meta={<ToolMeta item={item} />}
      defaultExpanded={view.expanded === true || item.status === 'error'}
    >
      {hasBody ? view.body(item, args) : undefined}
    </ToolCard>
  )
}
