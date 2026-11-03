import './file-tool-details.css'
import { Tooltip, TooltipContent, TooltipTrigger } from '@coko/ui'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import type { TimelineItem } from './timeline.ts'
import { useToolDetailCopy } from './tool-detail-copy.ts'

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
  const { copied, copy } = useToolDetailCopy(text)
  const [wrap, setWrap] = React.useState(false)
  const lines = text === '' ? [] : text.split('\n')
  const cap = kind === 'edit' ? 9 : 8
  const head = Math.ceil(cap / 2)
  const tail = Math.floor(cap / 2)
  const collapsed = !expanded && lines.length > cap
  const added = kind === 'edit' ? lines.filter((line) => line.startsWith('+')).length : 0
  const deleted = kind === 'edit' ? lines.filter((line) => line.startsWith('-')).length : 0
  return (
    <div data-file-detail={kind} className="file-detail" data-wrap={wrap || undefined}>
      <div className="file-detail-header">
        <span className="file-detail-language">{t('tool.fileCode')}</span>
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
                <FileToolbarIcon kind={wrap ? 'nowrap' : 'wrap'} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t('tool.fileWrap')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="file-detail-action focus-ring"
                aria-label={t(copied ? 'tool.fileCopied' : 'tool.fileCopy')}
                onClick={() => void copy()}
              >
                <FileToolbarIcon kind={copied ? 'check' : 'copy'} />
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

/** Toolbar artwork from the locked reference, using the same 16px viewBox and regular stroke. */
function FileToolbarIcon({ kind }: { kind: 'copy' | 'check' | 'wrap' | 'nowrap' }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" fill="none" strokeWidth="1">
      {kind === 'copy' ? (
        <>
          <rect x="1.52075" y="4.07373" width="10.3932" height="10.3932" rx="2" stroke="currentColor" />
          <path
            d="M11.9792 1.53296C13.36 1.53296 14.4792 2.65225 14.4792 4.03296V9.42847C14.4792 10.3756 13.9521 11.1987 13.1755 11.6228V10.3298C13.3652 10.0787 13.4792 9.7674 13.4792 9.42847V4.03296C13.4792 3.20453 12.8077 2.53296 11.9792 2.53296H6.58374C6.27966 2.53301 5.99684 2.6235 5.7605 2.77905H4.42358C4.85652 2.03463 5.66056 1.53304 6.58374 1.53296H11.9792Z"
            fill="currentColor"
          />
        </>
      ) : kind === 'check' ? (
        <path d="M2.25 8.5L5.49732 11.7473C5.90519 12.1552 6.57263 12.1344 6.95426 11.7018L13.75 4" stroke="currentColor" />
      ) : (
        <>
          <path d="M2 15H1V1H2V15ZM15 15H14V1H15V15Z" fill="currentColor" />
          {kind === 'nowrap' ? (
            <path
              d="M12.3535 7.64645C12.5487 7.84171 12.5487 8.15829 12.3535 8.35355L9.85352 10.8535L9.14648 10.1465L10.793 8.5H3.5V7.5H10.793L9.14648 5.85352L9.85352 5.14648L12.3535 7.64645Z"
              fill="currentColor"
            />
          ) : (
            <path
              d="M10.9999 8C10.9999 6.89543 10.1046 6 9 6H4.5V5H9C10.6568 5 11.9999 6.34315 11.9999 8C11.9999 9.65685 10.6568 11 9 11H6.20703L6.85351 11.6465L6.14648 12.3535L4.64652 10.8536C4.45126 10.6583 4.45126 10.3417 4.64652 10.1464L6.14648 8.64648L6.85351 9.35352L6.20703 10H9C10.1046 10 10.9999 9.10457 10.9999 8Z"
              fill="currentColor"
            />
          )}
        </>
      )}
    </svg>
  )
}
