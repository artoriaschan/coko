import type { MessageKey } from '@coko/i18n'
import { Button, Dialog, DialogContent, DialogTitle, ToolCard, ToolOutput } from '@coko/ui'
import { BrainIcon, CodeIcon, FolderTreeIcon, ListChecksIcon, ListPlusIcon, ListTodoIcon, Maximize2Icon, SendIcon } from 'lucide-react'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import { FileToolBody } from './file-tool-details.tsx'
import { AgentCard } from './agent-card.tsx'
import { useActiveEntries } from './agents-button.tsx'
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
  grep: { icon: <ToolIcon kind="search" />, title: 'tool.grep', summary: (a) => str(a.pattern), body: (item) => <TextBody text={output(item)} /> },
  find: { icon: <ToolIcon kind="search" />, title: 'tool.find', summary: (a) => str(a.pattern), body: (item) => <TextBody text={output(item)} /> },
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

export function ToolCardView({ item, onInspect }: { item: ToolItem; onInspect?: () => void }) {
  // agent：子代理卡（状态来自 agent_start / agent_end 与 agent_update）。
  if (item.call.name === 'agent') return <AgentCard item={item} />
  return <ToolCallCard item={item} onInspect={onInspect} />
}

function Inspect({ onInspect }: { onInspect?: () => void }) {
  const { t } = useI18n()
  if (!onInspect) return null
  return (
    <button type="button" className="tool-inspect rounded-round focus-ring" onClick={onInspect}>
      <svg aria-hidden viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1">
        <path d="M4.67398 4.25061L1.36094 7.86484C1.29085 7.9413 1.29085 8.05866 1.36094 8.13513L4.67398 11.7494M11.3262 4.25061L14.6392 7.86484C14.7093 7.9413 14.7093 8.05866 14.6392 8.13513L11.3262 11.7494M9.56222 3.62573L6.43774 12.3743" />
      </svg>
      {t('tool.inspect')}
    </button>
  )
}

function ToolCallCard({ item, onInspect }: { item: ToolItem; onInspect?: () => void }) {
  const [expanded, onExpandedChange] = useProcessDisclosure()
  const { t } = useI18n()
  const args = item.call.arguments && typeof item.call.arguments === 'object' ? (item.call.arguments as Record<string, unknown>) : {}
  const view = VIEWS[item.call.name]
  const statusLabel = t(`tool.${item.status}`)
  if (!view) {
    return (
      <ToolCard
        variant="row"
        expanded={expanded}
        onExpandedChange={onExpandedChange}
        data-tool={item.call.name}
        icon={<ToolIcon kind="generic" />}
        title={t('tool.unknown')}
        summary={item.call.name}
        status={item.status}
        statusLabel={statusLabel}
        meta={<ToolMeta item={item} />}
      >
        <HookBlockNote item={item} />
        <GenericBody item={item} />
        <ToolImages item={item} />
        <Inspect onInspect={onInspect} />
      </ToolCard>
    )
  }
  const hasBody =
    item.call.name === 'bash' ||
    item.result !== null ||
    item.live?.partialResult !== undefined ||
    item.call.name === 'write' ||
    item.call.name === 'memory_write'
  return (
    <ToolCard
      variant="row"
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      data-tool={item.call.name}
      icon={view.icon}
      title={t(typeof view.title === 'function' ? view.title(item) : view.title)}
      summary={item.status === 'error' && output(item).trim() !== '' ? output(item).split('\n')[0] : view.summary(args)}
      status={item.status}
      statusLabel={statusLabel}
      meta={<ToolMeta item={item} />}
    >
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
      <Inspect onInspect={onInspect} />
    </ToolCard>
  )
}

// ── 工具结果中的图片（MCP 的 image 块，例如浏览器截图）──

/** 显示为缩略图的位图类型；SVG 等不显示（不在界面中渲染工具给出的矢量内容）。 */
const RASTER_IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const BASE64 = /^[A-Za-z0-9+/=\s]+$/

interface ToolImage {
  src: string
}

function imagesOf(content: unknown): ToolImage[] {
  if (!Array.isArray(content)) return []
  return content.flatMap((block: unknown) => {
    const b = block as { type?: unknown; data?: unknown; mimeType?: unknown } | null
    if (b?.type !== 'image' || typeof b.data !== 'string' || typeof b.mimeType !== 'string' || !RASTER_IMAGES.has(b.mimeType) || !BASE64.test(b.data)) return []
    return [{ src: `data:${b.mimeType};base64,${b.data.replace(/\s/g, '')}` }]
  })
}

/** 该调用的结果图片：已提交的 toolResult 条目，或进行中 Run 的结果。 */
function useToolImages(item: ToolItem): ToolImage[] {
  const { entries } = useActiveEntries()
  return React.useMemo(() => {
    const committed = entries.find((e) => {
      const payload = e.payload as { role?: unknown; toolCallId?: unknown } | null
      return e.kind === 'message' && payload?.role === 'toolResult' && payload.toolCallId === item.call.id
    })
    const content = committed ? (committed.payload as { content?: unknown }).content : (item.live?.result as { content?: unknown } | undefined)?.content
    return imagesOf(content)
  }, [entries, item.call.id, item.live?.result])
}

/** 结果图片的缩略图；"查看大图"打开对话框显示原图。 */
function ToolImages({ item }: { item: ToolItem }) {
  const { t } = useI18n()
  const images = useToolImages(item)
  const [open, setOpen] = React.useState<number | null>(null)
  // 对话框不是由 DialogTrigger 打开：关闭后把焦点还给打开它的按钮。
  const openers = React.useRef<(HTMLButtonElement | null)[]>([])
  const opened = React.useRef<number | null>(null)
  if (images.length === 0) return null
  return (
    <div className="flex flex-wrap gap-3 border-t-hairline border-border px-3 py-2">
      {images.map((image, index) => {
        const alt = t('mcp.image.alt', { index: index + 1 })
        return (
          <figure key={index} className="flex flex-col items-start gap-1">
            <img
              data-tool-image
              src={image.src}
              alt={alt}
              className="max-h-40 max-w-full rounded-lg border-hairline border-border bg-muted/50 object-contain"
            />
            <Button
              ref={(el) => {
                openers.current[index] = el
              }}
              variant="ghost"
              size="sm"
              data-action="open-image"
              onClick={() => {
                opened.current = index
                setOpen(index)
              }}
            >
              <Maximize2Icon />
              {t('mcp.image.open')}
            </Button>
          </figure>
        )
      })}
      {open !== null && images[open] && (
        <Dialog open onOpenChange={(value) => !value && setOpen(null)}>
          <DialogContent
            closeLabel={t('mcp.image.close')}
            className="max-w-[min(90vw,1200px)] flex-col gap-3 p-5"
            data-tool-image-dialog
            onCloseAutoFocus={(event) => {
              const button = opened.current === null ? null : openers.current[opened.current]
              if (!button) return
              event.preventDefault()
              button.focus()
            }}
          >
            <DialogTitle>{t('mcp.image.alt', { index: open + 1 })}</DialogTitle>
            <img
              src={images[open].src}
              alt={t('mcp.image.alt', { index: open + 1 })}
              className="max-h-[75vh] max-w-full self-center rounded-lg object-contain"
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
