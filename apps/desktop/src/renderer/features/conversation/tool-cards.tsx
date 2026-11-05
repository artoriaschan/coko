import type { MessageKey } from '@coko/i18n'
import { ToolCard, ToolOutput } from '@coko/ui'
import { BrainIcon, CodeIcon, FolderTreeIcon, ListChecksIcon, ListPlusIcon, ListTodoIcon, SendIcon } from 'lucide-react'
import * as React from 'react'
import { hookBlock, ToolStateMeta, ToolStateDetail } from './tool-states.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { FileToolBody, fileDiffTotals } from './file-tool-details.tsx'
import { SearchToolBody, StructuredToolBody } from './structured-tool-details.tsx'
import { OriginalIO, OriginalToolIO, ToolInspect } from './original-tool-io.tsx'
import { AgentCard } from './agent-card.tsx'
import { ToolImages } from './tool-image-details.tsx'
import { TerminalDetails } from './terminal-details.tsx'
import { resultText, type TimelineItem } from './timeline.ts'
import { useProcessDisclosure } from './process-disclosure.tsx'
import { ToolIcon } from './tool-icon.tsx'

type ToolItem = Extract<TimelineItem, { kind: 'tool' }>

interface ToolView {
  icon: React.ReactNode
  /** 函数形式按调用结果给出标题（例如 memory_write 的"已记住 / 已更新记忆"）。 */
  title: MessageKey | ((item: ToolItem) => MessageKey)
  /** 摘要使用的参数字段，保持原文。 */
  summary: (args: Record<string, unknown>) => string | undefined
  body: (item: ToolItem, args: Record<string, unknown>) => React.ReactNode
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

const LSP_TITLES = {
  diagnostics: 'lsp.tool.diagnostics',
  definition: 'lsp.tool.definition',
  references: 'lsp.tool.references',
  hover: 'lsp.tool.hover',
} as const

/** 按工具名分发的专属展示；未登记的工具使用通用展示。 */
const VIEWS: Record<string, ToolView> = {
  bash: {
    icon: <ToolIcon kind="command" />,
    title: 'tool.bash',
    summary: (a) => str(a.command),
    body: (item, args) => <TerminalDetails item={item} args={args} jobId={backgroundJobId(item)} />,
  },
  read: {
    icon: <ToolIcon kind="read" />,
    title: 'tool.read',
    summary: (a) => str(a.path),
    body: (item, a) => <FileToolBody item={item} args={a} fallback={<GenericBody item={item} />} />,
  },
  write: {
    icon: <ToolIcon kind="edit" />,
    title: 'tool.write',
    summary: (a) => str(a.path),
    body: (item, a) => <FileToolBody item={item} args={a} fallback={<GenericBody item={item} />} />,
  },
  edit: {
    icon: <ToolIcon kind="edit" />,
    title: 'tool.edit',
    summary: (a) => str(a.path),
    body: (item, a) => <FileToolBody item={item} args={a} fallback={<GenericBody item={item} />} />,
  },
  grep: {
    icon: <ToolIcon kind="search" />,
    title: 'tool.grep',
    summary: (a) => str(a.pattern),
    body: (item) => <SearchToolBody item={item} fallback={<GenericBody item={item} />} />,
  },
  find: {
    icon: <ToolIcon kind="search" />,
    title: 'tool.find',
    summary: (a) => str(a.pattern),
    body: (item) => <SearchToolBody item={item} fallback={<GenericBody item={item} />} />,
  },
  ls: {
    icon: <FolderTreeIcon />,
    title: 'tool.ls',
    summary: (a) => str(a.path) ?? '.',
    body: (item) => <SearchToolBody item={item} fallback={<GenericBody item={item} />} />,
  },
  memory_list: { icon: <BrainIcon />, title: 'memory.tool.list', summary: (a) => str(a.scope), body: (item) => <GenericBody item={item} /> },
  memory_write: {
    icon: <BrainIcon />,
    title: (item) => {
      const action = memoryAction(item)
      return action === 'created' ? 'memory.tool.written' : action === 'updated' ? 'memory.tool.updated' : 'memory.tool.write'
    },
    summary: (a) => str(a.content),
    body: (item) => <StructuredToolBody item={item} fallback={<GenericBody item={item} />} />,
  },
  memory_delete: {
    icon: <BrainIcon />,
    title: (item) => (memoryAction(item) === 'deleted' ? 'memory.tool.deleted' : 'memory.tool.delete'),
    summary: (a) => str(a.id),
    body: (item) => <StructuredToolBody item={item} fallback={<GenericBody item={item} />} />,
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
    body: (item) => <StructuredToolBody item={item} fallback={<GenericBody item={item} />} />,
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
    body: (item, a) => (
      <>
        <TeamMessageBody item={item} message={str(a.message)} />
        <OriginalIO>
          <OriginalToolIO item={item} />
        </OriginalIO>
      </>
    ),
  },
  task_create: { icon: <ListPlusIcon />, title: 'teams.tool.taskCreate', summary: (a) => str(a.subject), body: (item) => <OriginalToolIO item={item} /> },
  task_update: {
    icon: <ListTodoIcon />,
    title: 'teams.tool.taskUpdate',
    summary: (a) => {
      const id = str(a.id)
      const status = str(a.status) ?? str(a.owner)
      return id === undefined ? undefined : status ? `${id} · ${status}` : id
    },
    body: (item) => <OriginalToolIO item={item} />,
  },
  task_list: { icon: <ListChecksIcon />, title: 'teams.tool.taskList', summary: () => undefined, body: (item) => <OriginalToolIO item={item} /> },
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
      <code data-user-content className="min-w-0 break-all font-mono text-foreground" title={hook.command}>
        {hook.command}
      </code>
    </p>
  )
}

/** 未知工具：工具名为摘要，参数与结果按原样展示。 */
function GenericBody({ item }: { item: ToolItem }) {
  const { t } = useI18n()
  const result = item.result ? [item.result.text, json(item.result.details)].filter(Boolean).join('\n\n') : resultText(item.live?.partialResult)
  return (
    <div className="tool-io-card">
      <div className="tool-io-section">
        <span className="tool-io-label">{t('tool.input')}</span>
        <span data-user-content className="tool-io-text">
          {json(item.call.arguments)}
        </span>
      </div>
      {(item.result !== null || item.live?.partialResult !== undefined) && (
        <div className="tool-io-section">
          <span className="tool-io-label">{t('tool.output')}</span>
          <span data-user-content className="tool-io-text" data-error={item.status === 'error' || undefined}>
            {result === '' ? t('tool.noOutput') : result}
          </span>
        </div>
      )}
    </div>
  )
}

export function ToolCardView({
  item,
  onInspect,
  rootAttributes,
}: {
  item: ToolItem
  onInspect?: () => void
  rootAttributes?: React.ComponentProps<typeof ToolCard>['rootAttributes']
}) {
  // agent：子代理卡（状态来自 agent_start / agent_end 与 agent_update）。
  if (item.call.name === 'agent') return <AgentCard item={item} onInspect={onInspect} rootAttributes={rootAttributes} />
  return <ToolCallCard item={item} onInspect={onInspect} rootAttributes={rootAttributes} />
}

function ToolCallCard({
  item,
  onInspect,
  rootAttributes,
}: {
  item: ToolItem
  onInspect?: () => void
  rootAttributes?: React.ComponentProps<typeof ToolCard>['rootAttributes']
}) {
  const [expanded, onExpandedChange] = useProcessDisclosure()
  const { t } = useI18n()
  const args = item.call.arguments && typeof item.call.arguments === 'object' ? (item.call.arguments as Record<string, unknown>) : {}
  const view = VIEWS[item.call.name]
  const statusLabel = t(
    item.confirmation?.answer === null
      ? 'confirmation.status'
      : item.status === 'pending' && item.result === null
        ? 'tool.noRecordedResult'
        : `tool.${item.status}`,
  )
  if (!view) {
    return (
      <ToolCard
        rootAttributes={rootAttributes}
        variant="row"
        expanded={expanded}
        onExpandedChange={onExpandedChange}
        data-tool={item.call.name}
        icon={<ToolIcon kind="generic" />}
        title={t('tool.unknown')}
        summary={item.call.name}
        status={item.status}
        statusLabel={statusLabel}
        meta={<ToolStateMeta item={item} />}
      >
        <HookBlockNote item={item} />
        <ToolStateDetail item={item} />
        <GenericBody item={item} />
        <ToolImages item={item} />
        <ToolInspect onInspect={onInspect} />
      </ToolCard>
    )
  }
  const totals = fileDiffTotals(item)
  const hasBody =
    item.call.name === 'bash' ||
    item.result !== null ||
    item.live?.partialResult !== undefined ||
    item.call.name === 'write' ||
    item.call.name === 'memory_write'
  return (
    <ToolCard
      rootAttributes={rootAttributes}
      variant="row"
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      data-tool={item.call.name}
      icon={view.icon}
      title={t(typeof view.title === 'function' ? view.title(item) : view.title)}
      summary={item.status === 'error' && output(item).trim() !== '' ? output(item).split('\n')[0] : view.summary(args)}
      status={item.status}
      statusLabel={statusLabel}
      meta={
        <>
          {totals && (
            <span data-slot="file-diff-totals" className="inline-flex shrink-0 gap-1">
              <span className="text-success-text">{t('tool.fileAdded', { count: totals.added })}</span>
              <span className="text-destructive">{t('tool.fileDeleted', { count: totals.deleted })}</span>
            </span>
          )}
          <ToolStateMeta item={item} />
        </>
      }
    >
      <ToolStateDetail item={item} />
      {hookBlock(item) ? (
        <div className="flex flex-col">
          <HookBlockNote item={item} />
          {view.body(item, args)}
        </div>
      ) : hasBody ? (
        view.body(item, args)
      ) : (
        <GenericBody item={item} />
      )}
      <ToolImages item={item} />
      <ToolInspect onInspect={onInspect} />
    </ToolCard>
  )
}
