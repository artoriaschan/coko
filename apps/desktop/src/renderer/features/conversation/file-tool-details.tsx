import './file-tool-details.css'
import { toast, Tooltip, TooltipContent, TooltipTrigger } from '@coko/ui'
import { CopyIcon, WrapTextIcon } from 'lucide-react'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import type { TimelineItem } from './timeline.ts'

type ToolItem = Extract<TimelineItem, { kind: 'tool' }>
const string = (value: unknown) => (typeof value === 'string' ? value : undefined)

/** File bodies consume recorded facts only. Opening a detail never reads or mutates the workspace. */
export function FileToolBody({ item, args, fallback }: { item: ToolItem; args: Record<string, unknown>; fallback: React.ReactNode }) {
  const path = string(args.path)
  if (!path || item.status !== 'done' || !item.result || item.result.isError) return fallback
  if (item.call.name === 'read') {
    if (/^(?:Read image file \[|\[Line \d+ is )/.test(item.result.text)) return fallback
    const offset = args.offset === undefined ? 1 : args.offset
    if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 1) return fallback
    const text = item.result.text
    // Only the built-in read's exact trailing recovery notice is separated. Preserve its original text.
    const note =
      /\n\n(\[(?:Showing lines \d+-\d+ of \d+(?: \([^\n]*\))?\. Use offset=\d+ to continue\.|\d+ more lines in file\. Use offset=\d+ to continue\.)\])$/.exec(
        text,
      )
    const content = note ? text.slice(0, note.index) : text
    return <FileCodeCard kind="read" path={path} text={content} offset={offset} note={note?.[1]} />
  }
  if (item.call.name === 'write') {
    const content = string(args.content)
    return content === undefined ? fallback : <FileCodeCard kind="write" path={path} text={content} offset={1} note={item.result.text} />
  }
  const diff = string((item.result.details as { diff?: unknown } | undefined)?.diff)
  return diff === undefined || diff === '' ? fallback : <FileCodeCard kind="edit" path={path} text={diff} offset={1} note={item.result.text} />
}

function FileCodeCard({ kind, path, text, offset, note }: { kind: 'read' | 'write' | 'edit'; path: string; text: string; offset: number; note?: string }) {
  const { t } = useI18n()
  const [expanded, setExpanded] = React.useState(false)
  const [wrap, setWrap] = React.useState(false)
  const lines = text === '' ? [] : text.split('\n')
  const cap = kind === 'edit' ? 9 : 8
  const head = Math.ceil(cap / 2)
  const tail = Math.floor(cap / 2)
  const collapsed = !expanded && lines.length > cap
  const added = kind === 'edit' ? lines.filter((line) => line.startsWith('+')).length : 0
  const deleted = kind === 'edit' ? lines.filter((line) => line.startsWith('-')).length : 0
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(t('tool.fileCopied'))
    } catch {
      toast.error(t('tool.fileCopyFailed'))
    }
  }
  return (
    <div data-file-detail={kind} className="file-detail" data-wrap={wrap || undefined}>
      <div className="file-detail-header">
        <span data-user-content className="file-detail-path" title={path}>
          {path}
        </span>
        <div className="file-detail-actions">
          {kind === 'edit' && (
            <span className="file-detail-stats">
              <span className="text-success-text">+{added}</span> <span className="text-destructive">−{deleted}</span>
            </span>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="file-detail-action focus-ring"
                aria-label={t('tool.fileWrap')}
                aria-pressed={wrap}
                onClick={() => setWrap(!wrap)}
              >
                <WrapTextIcon aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t('tool.fileWrap')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="file-detail-action focus-ring" aria-label={t('tool.fileCopy')} onClick={() => void copy()}>
                <CopyIcon aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t('tool.fileCopy')}</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="file-detail-code" tabIndex={0} role="region" aria-label={path}>
        {lines.length === 0 && <span className="file-detail-empty">{t('tool.fileEmpty')}</span>}
        {lines.map((line, index) => {
          if (collapsed && index >= head && index < lines.length - tail) {
            return index === head ? (
              <button type="button" className="file-detail-expand focus-ring" key="expand" onClick={() => setExpanded(true)}>
                {t('tool.fileShowAll', { count: lines.length })}
              </button>
            ) : null
          }
          const diff = kind === 'edit' ? (line.startsWith('+') ? 'added' : line.startsWith('-') ? 'deleted' : undefined) : undefined
          return (
            <div className="file-detail-line" data-diff={diff} key={index}>
              {kind !== 'edit' && (
                <span className="file-detail-gutter" aria-hidden>
                  {offset + index}
                </span>
              )}
              <span data-user-content>{line || '\u200b'}</span>
            </div>
          )
        })}
      </div>
      {note && (
        <div data-user-content className="file-detail-note">
          {note}
        </div>
      )}
    </div>
  )
}
