import type { MessageKey } from '@coko/i18n'
import { DiffBlock, ToolCard, ToolOutput } from '@coko/ui'
import {
  BrainIcon,
  CodeIcon,
  FilePenIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderSearchIcon,
  FolderTreeIcon,
  ListChecksIcon,
  ListPlusIcon,
  ListTodoIcon,
  SearchIcon,
  SendIcon,
  TerminalIcon,
  WrenchIcon,
} from 'lucide-react'
import type * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import { AgentCard } from './agent-card.tsx'
import { JobChip } from './job-row.tsx'
import { resultText, type TimelineItem } from './timeline.ts'

type ToolItem = Extract<TimelineItem, { kind: 'tool' }>

interface ToolView {
  icon: React.ReactNode
  /** 函数形式按调用结果给出标题（例如 memory_write 的"已记住 / 已更新记忆"）。 */
  title: MessageKey | ((item: ToolItem) => MessageKey)
  /** 摘要使用的参数字段，保持原文。 */
  summary: (args: Record<string, unknown>) => string | undefined
  body: (item: ToolItem, args: Record<string, unknown>) => React.ReactNode
  /** 默认展开：命令输出与 diff 是主要信息。 */
  expanded?: boolean
}

const str = (value: unknown) => (typeof value === 'string' ? value : undefined)
const output = (item: ToolItem) => item.result?.text ?? resultText(item.live?.partialResult)

/** memory_write / memory_delete 成功后结果 details 中的动作（MemoryToolDetails.action）。 */
function memoryAction(item: ToolItem): string | undefined {
  if (item.status !== 'done' || item.result?.isError) return undefined
  const action = (item.result?.details as { action?: unknown } | undefined)?.action
  return typeof action === 'string' ? action : undefined
}

function TextBody({ text }: { text: string }) {
  const { t } = useI18n()
  return <ToolOutput>{text === '' ? t('tool.noOutput') : text}</ToolOutput>
}

/** 后台 bash 的结果（"Started background job <id>: <label>. …"）中的 jobId。 */
const STARTED_JOB = /^Started background job (job_[0-9a-f]+):/

export function backgroundJobId(item: ToolItem): string | undefined {
  if (item.status !== 'done' || !item.result || item.result.isError) return undefined
  return STARTED_JOB.exec(item.result.text)?.[1]
}

/** bash 的明细：后台 bash 在输出之上显示 Job chip（点击在右栏打开该 Job）。 */
function BashBody({ item }: { item: ToolItem }) {
  const jobId = backgroundJobId(item)
  if (!jobId) return <TextBody text={output(item)} />
  return (
    <div className="flex flex-col">
      <div className="px-3 pt-2">
        <JobChip jobId={jobId} />
      </div>
      <TextBody text={output(item)} />
    </div>
  )
}

/** lsp 的结果计数（LspToolDetails）。 */
function lspCounts(item: ToolItem): { count: number; total: number; received?: false } | undefined {
  const details = item.result?.details as { count?: unknown; total?: unknown; received?: unknown } | undefined
  if (item.result?.isError || typeof details?.count !== 'number' || typeof details.total !== 'number') return undefined
  return { count: details.count, total: details.total, ...(details.received === false ? { received: false as const } : {}) }
}

const LSP_TITLES = {
  diagnostics: 'lsp.tool.diagnostics',
  definition: 'lsp.tool.definition',
  references: 'lsp.tool.references',
  hover: 'lsp.tool.hover',
} as const

/** lsp 的明细：结果计数在输出之上。 */
function LspBody({ item }: { item: ToolItem }) {
  const { t } = useI18n()
  const counts = lspCounts(item)
  return (
    <div className="flex flex-col">
      {counts && (
        <p data-lsp-count={counts.count} className="px-3 pt-2 text-ui-small text-muted-foreground">
          {counts.received === false
            ? t('lsp.tool.notReceived')
            : counts.total === 0
              ? t('lsp.tool.none')
              : counts.count < counts.total
                ? t('lsp.tool.truncated', { count: counts.count, total: counts.total })
                : t('lsp.tool.count', { count: counts.count })}
        </p>
      )}
      <TextBody text={output(item)} />
    </div>
  )
}

/** 按工具名分发的专属展示；未登记的工具使用通用展示。 */
const VIEWS: Record<string, ToolView> = {
  bash: {
    icon: <TerminalIcon />,
    title: 'tool.bash',
    summary: (a) => str(a.command),
    body: (item) => <BashBody item={item} />,
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
  memory_list: { icon: <BrainIcon />, title: 'memory.tool.list', summary: (a) => str(a.scope), body: (item) => <TextBody text={output(item)} /> },
  memory_write: {
    icon: <BrainIcon />,
    title: (item) => {
      const action = memoryAction(item)
      return action === 'created' ? 'memory.tool.written' : action === 'updated' ? 'memory.tool.updated' : 'memory.tool.write'
    },
    summary: (a) => str(a.content),
    body: (item, a) => (item.result?.isError ? <TextBody text={output(item)} /> : <ToolOutput>{str(a.content) ?? ''}</ToolOutput>),
  },
  memory_delete: {
    icon: <BrainIcon />,
    title: (item) => (memoryAction(item) === 'deleted' ? 'memory.tool.deleted' : 'memory.tool.delete'),
    summary: (a) => str(a.id),
    body: (item) => <TextBody text={output(item)} />,
  },
  lsp: {
    icon: <CodeIcon />,
    title: (item) => {
      const operation = (item.call.arguments as { operation?: unknown } | undefined)?.operation
      return typeof operation === 'string' && operation in LSP_TITLES ? LSP_TITLES[operation as keyof typeof LSP_TITLES] : 'lsp.tool.diagnostics'
    },
    summary: (a) => {
      const file = str(a.file_path)
      if (file === undefined) return undefined
      return typeof a.line === 'number' && typeof a.character === 'number' ? `${file}:${a.line}:${a.character}` : file
    },
    body: (item) => <LspBody item={item} />,
  },
  // Agent Teams：消息与任务板工具（docs/subsystems/teams.md）。
  send_message: {
    icon: <SendIcon />,
    title: 'teams.tool.sendMessage',
    summary: (a) => {
      const to = str(a.to)
      const summary = str(a.summary)
      return to === undefined ? undefined : summary ? `${to} · ${summary}` : to
    },
    body: (item, a) => <TeamMessageBody item={item} message={str(a.message)} />,
  },
  task_create: { icon: <ListPlusIcon />, title: 'teams.tool.taskCreate', summary: (a) => str(a.subject), body: (item) => <TextBody text={output(item)} /> },
  task_update: {
    icon: <ListTodoIcon />,
    title: 'teams.tool.taskUpdate',
    summary: (a) => {
      const id = str(a.id)
      const status = str(a.status) ?? str(a.owner)
      return id === undefined ? undefined : status ? `${id} · ${status}` : id
    },
    body: (item) => <TextBody text={output(item)} />,
  },
  task_list: { icon: <ListChecksIcon />, title: 'teams.tool.taskList', summary: () => undefined, body: (item) => <TextBody text={output(item)} /> },
}

/** send_message 的明细：发出的正文（模型输出，原样）与结果。 */
function TeamMessageBody({ item, message }: { item: ToolItem; message: string | undefined }) {
  if (item.result?.isError || message === undefined) return <TextBody text={output(item)} />
  return (
    <div className="flex flex-col">
      <ToolOutput>{message}</ToolOutput>
      <p className="border-t-hairline border-border px-3 py-2 text-ui-small text-muted-foreground">{output(item)}</p>
    </div>
  )
}

const json = (value: unknown) => {
  if (value === undefined) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/** 被 Hook 阻止的调用：明细开头显示拦下它的 Hook 命令（已脱敏）。 */
function HookBlockNote({ item }: { item: ToolItem }) {
  const { t } = useI18n()
  const hook = hookBlock(item)
  if (!hook) return null
  return (
    <p data-slot="hook-block" className="flex min-w-0 items-baseline gap-2 px-3 pt-2 text-ui-small text-muted-foreground">
      <span className="shrink-0">{t('hooks.blockedBy')}</span>
      <code data-user-content className="min-w-0 truncate font-mono text-foreground" title={hook.command}>
        {hook.command}
      </code>
    </p>
  )
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

/** 外部 Hook 拦下的调用（toolResult details.hostBlock { by: hook }，运行时写入，工具自身不能声明）。 */
export function hookBlock(item: ToolItem): { command: string } | undefined {
  const mark = (item.result?.details as { hostBlock?: { by?: unknown; command?: unknown } } | undefined)?.hostBlock
  return mark?.by === 'hook' && typeof mark.command === 'string' ? { command: mark.command } : undefined
}

/** 标题行的元信息：Hook 拦截、沙箱拒绝与已结束审批的决定。 */
function ToolMeta({ item }: { item: ToolItem }) {
  const { t } = useI18n()
  const denied = sandboxDenial(item)
  const hook = hookBlock(item)
  return (
    <>
      {hook && (
        <span
          data-hook-blocked
          className="max-w-60 shrink truncate text-ui-small text-destructive"
          title={t('hooks.blockedCommand', { command: hook.command })}
        >
          {t('hooks.blockedBy')}
        </span>
      )}
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
      label =
        decision.by === 'hook'
          ? t('hooks.allowedBy')
          : target
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
  // agent：子代理卡（状态来自 agent_start / agent_end 与 agent_update）。
  if (item.call.name === 'agent') return <AgentCard item={item} />
  return <ToolCallCard item={item} />
}

function ToolCallCard({ item }: { item: ToolItem }) {
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
        <HookBlockNote item={item} />
        <GenericBody item={item} />
      </ToolCard>
    )
  }
  const hasBody = item.result !== null || item.live?.partialResult !== undefined || item.call.name === 'write' || item.call.name === 'memory_write'
  return (
    <ToolCard
      data-tool={item.call.name}
      icon={view.icon}
      title={t(typeof view.title === 'function' ? view.title(item) : view.title)}
      summary={view.summary(args)}
      status={item.status}
      statusLabel={statusLabel}
      meta={<ToolMeta item={item} />}
      defaultExpanded={view.expanded === true || item.status === 'error'}
    >
      {hookBlock(item) ? (
        <div className="flex flex-col">
          <HookBlockNote item={item} />
          {view.body(item, args)}
        </div>
      ) : hasBody ? (
        view.body(item, args)
      ) : undefined}
    </ToolCard>
  )
}
