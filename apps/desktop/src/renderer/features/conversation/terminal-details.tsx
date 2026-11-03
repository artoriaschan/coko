import { cn, toast } from '@coko/ui'
import Anser from 'anser'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import { JobChip } from './job-row.tsx'
import { resultText, type TimelineItem } from './timeline.ts'
import './terminal-details.css'

type ToolItem = Extract<TimelineItem, { kind: 'tool' }>
const FG: Record<string, string> = {
  'ansi-black': 'text-terminal-muted',
  'ansi-bright-black': 'text-terminal-muted',
  'ansi-red': 'text-terminal-red',
  'ansi-bright-red': 'text-terminal-red',
  'ansi-green': 'text-terminal-green',
  'ansi-bright-green': 'text-terminal-green',
  'ansi-yellow': 'text-terminal-yellow',
  'ansi-bright-yellow': 'text-terminal-yellow',
  'ansi-blue': 'text-terminal-blue',
  'ansi-bright-blue': 'text-terminal-blue',
  'ansi-magenta': 'text-terminal-magenta',
  'ansi-bright-magenta': 'text-terminal-magenta',
  'ansi-cyan': 'text-terminal-cyan',
  'ansi-bright-cyan': 'text-terminal-cyan',
}
const BG: Record<string, string> = {
  'ansi-red': 'bg-diff-deleted',
  'ansi-bright-red': 'bg-diff-deleted',
  'ansi-green': 'bg-diff-added',
  'ansi-bright-green': 'bg-diff-added',
}
const DECORATIONS: Record<string, string> = {
  bold: 'font-medium',
  dim: 'opacity-70',
  italic: 'italic',
  underline: 'underline',
  strikethrough: 'line-through',
  hidden: 'invisible',
  reverse: 'bg-foreground text-background',
}
// Match the existing Job output renderer's supported SGR/control handling. Raw text remains the copy payload.
// eslint-disable-next-line no-control-regex
const OSC = /\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)?/g
// eslint-disable-next-line no-control-regex
const C0 = /[\u0000-\u0008\u000B\u000C\u000E-\u001A\u001C-\u001F\u007F]/g
function AnsiOutput({ text }: { text: string }) {
  const lines = React.useMemo(() => {
    const display = text
      .replace(OSC, '')
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.slice(line.lastIndexOf('\r') + 1))
      .join('\n')
      .replace(C0, '')
    const lines: { text: string; className: string }[][] = [[]]
    for (const part of Anser.ansiToJson(display, { use_classes: true, remove_empty: true })) {
      const className = cn(part.fg && FG[part.fg], part.bg && BG[part.bg], ...part.decorations.map((d) => DECORATIONS[d]))
      const fragments = part.content.split('\n')
      fragments.forEach((text, index) => {
        lines[lines.length - 1]!.push({ text: text + (index < fragments.length - 1 ? '\n' : ''), className })
        if (index < fragments.length - 1) lines.push([])
      })
    }
    return lines
  }, [text])
  return lines.map((line, index) => (
    <span data-terminal-line key={index}>
      {line.map((part, partIndex) => (
        <span key={partIndex} className={part.className}>
          {part.text}
        </span>
      ))}
    </span>
  ))
}

/** Coko command data only: a completed tool without a recorded exit never implies exit 0. */
export function TerminalDetails({ item, args, jobId }: { item: ToolItem; args: Record<string, unknown>; jobId: string | undefined }) {
  const { t } = useI18n()
  const [copied, setCopied] = React.useState(false)
  const reset = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  React.useEffect(() => () => clearTimeout(reset.current), [])
  const raw = item.result?.text ?? resultText(item.live?.partialResult)
  const details = item.result?.details as { hostBlock?: unknown; sandbox?: { denied?: unknown } } | undefined
  const blocked =
    item.status === 'awaiting' || item.approval?.decision?.outcome === 'denied' || details?.hostBlock !== undefined || details?.sandbox?.denied === true
  const structured = item.result?.structuredContent
  const data = structured !== null && typeof structured === 'object' ? (structured as Record<string, unknown>) : undefined
  const exitCode = typeof data?.exit_code === 'number' && Number.isFinite(data.exit_code) ? data.exit_code : undefined
  // Prefer complete structured output; when it was capped, keep the existing text/spill locator intact.
  const text = typeof data?.output === 'string' && data.truncated === false ? data.output : raw
  const command = typeof args.command === 'string' ? args.command : undefined
  const running = item.status === 'running'
  const state = running ? 'running' : exitCode === 0 ? 'done' : item.status === 'error' || exitCode !== undefined ? 'error' : 'pending'
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text === '' ? (command ?? '') : text)
      setCopied(true)
      clearTimeout(reset.current)
      reset.current = setTimeout(() => setCopied(false), 1800)
    } catch {
      toast.error(t('tool.terminal.copyFailed'))
    }
  }
  if (blocked || command === undefined) {
    return (
      <div className="tool-io-card">
        <div className="tool-io-section">
          <span className="tool-io-label">{t('tool.input')}</span>
          <span data-user-content className="tool-io-text">
            {JSON.stringify(args, null, 2)}
          </span>
        </div>
        {item.result && (
          <div className="tool-io-section">
            <span className="tool-io-label">{t('tool.output')}</span>
            <span data-user-content className="tool-io-text" data-error={item.result.isError || undefined}>
              {raw}
            </span>
          </div>
        )}
      </div>
    )
  }
  const body = text !== '' || (item.result !== null && !jobId)
  return (
    <>
      <div
        data-terminal
        data-terminal-state={state}
        data-body={body || undefined}
        className="conversation-terminal rounded-lg font-conversation-mono text-ui-terminal"
      >
        <div className="conversation-terminal-header">
          <div className="conversation-terminal-prompt">
            {!jobId && (
              <span className="conversation-terminal-state" role="img" aria-label={t(`tool.${item.status}`)}>
                {running ? (
                  <svg aria-hidden viewBox="0 0 24 24" width="14" height="14">
                    <circle className="conversation-terminal-track" cx="12" cy="12" r="9.5" />
                    <circle className="conversation-terminal-arc" cx="12" cy="12" r="9.5" />
                  </svg>
                ) : (
                  <svg aria-hidden viewBox="0 0 10 10" width="10" height="10">
                    <circle cx="5" cy="5" r="3" fill="currentColor" />
                  </svg>
                )}
              </span>
            )}
            <pre data-user-content data-terminal-command aria-label={t('tool.terminal.command')}>
              {command.split('\n').map((line, i) => (
                <span className="conversation-terminal-command-line" key={i}>
                  <span aria-hidden className="conversation-terminal-dollar">
                    $
                  </span>
                  <span data-command-text>
                    {line}
                    {i < command.split('\n').length - 1 ? '\n' : ''}
                  </span>
                </span>
              ))}
            </pre>
          </div>
          {exitCode !== undefined && exitCode !== 0 && (
            <span className="conversation-terminal-exit rounded-round">{t('tool.terminal.exitCode', { code: exitCode })}</span>
          )}
          <button
            type="button"
            className="conversation-terminal-copy focus-ring"
            aria-label={copied ? t('tool.terminal.copied') : text === '' ? t('tool.terminal.copyCommand') : t('tool.terminal.copy')}
            onClick={() => void copy()}
          >
            {copied ? t('tool.terminal.copied') : t('tool.terminal.copy')}
          </button>
        </div>
        {body && (
          <pre data-user-content data-terminal-output tabIndex={0} aria-label={t('tool.terminal.output')} className="conversation-terminal-output focus-ring">
            {text === '' ? <span className="text-conversation-process-muted">{t('tool.noOutput')}</span> : <AnsiOutput text={text} />}
          </pre>
        )}
      </div>
      {jobId && (
        <div className="conversation-terminal-job">
          <JobChip jobId={jobId} />
        </div>
      )}
    </>
  )
}
