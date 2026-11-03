import './structured-tool-details.css'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import type { TimelineItem } from './timeline.ts'
import { useToolDetailCopy } from './tool-detail-copy.ts'

type ToolItem = Extract<TimelineItem, { kind: 'tool' }>
const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
const string = (value: unknown) => (typeof value === 'string' ? value : undefined)
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** No parsing of result text: current search tools record no structured matches or paths. */
export function SearchToolBody({ item, fallback }: { item: ToolItem; fallback: React.ReactNode }) {
  if (item.status !== 'done' || !item.result || item.result.isError) return fallback
  return (
    <>
      <SearchOutput text={item.result.text} />
      <OriginalIO>{fallback}</OriginalIO>
    </>
  )
}

function OriginalIO({ children }: { children: React.ReactNode }) {
  const { t } = useI18n()
  return (
    <details className="structured-original">
      <summary className="focus-ring">{t('tool.originalIO')}</summary>
      {children}
    </details>
  )
}

/** The SearchBlock's raw-output adaptation retains its exact line geometry and eight-row chat cap. */
function SearchOutput({ text }: { text: string }) {
  const { t } = useI18n()
  const { copied, copy } = useToolDetailCopy(text)
  const [expanded, setExpanded] = React.useState(false)
  const expandButton = React.useRef<HTMLButtonElement>(null)
  const restoreFocus = React.useRef(false)
  React.useLayoutEffect(() => {
    if (!expanded && restoreFocus.current) {
      expandButton.current?.focus()
      restoreFocus.current = false
    }
  }, [expanded])
  const lines = text === '' ? [] : text.split('\n')
  const capped = !expanded && lines.length > 8
  return (
    <div className="search-detail" data-search-detail>
      <div className="search-detail-header">
        <span className="search-detail-summary">{t('tool.result')}</span>
        {text !== '' && (
          <button type="button" className="search-detail-copy focus-ring" onClick={() => void copy()}>
            {t(copied ? 'tool.fileCopied' : 'tool.fileCopy')}
          </button>
        )}
      </div>
      {lines.length === 0 ? (
        <div className="search-detail-empty">{t('tool.noOutput')}</div>
      ) : (
        <div className="search-detail-body" tabIndex={0} role="region" aria-label={t('tool.result')}>
          {lines.map((line, index) => {
            if (capped && index >= 4 && index < lines.length - 4)
              return index === 4 ? (
                <button
                  ref={expandButton}
                  type="button"
                  key="expand"
                  className="search-detail-expand focus-ring"
                  aria-expanded={false}
                  aria-label={t('tool.searchExpandAria', { count: lines.length - 8 })}
                  onClick={() => setExpanded(true)}
                >
                  {t('tool.searchExpand', { count: lines.length - 8 })}
                </button>
              ) : null
            return (
              <div className="search-detail-line" data-user-content key={index}>
                {line || '\u200b'}
              </div>
            )
          })}
          {expanded && lines.length > 8 && (
            <button
              type="button"
              className="search-detail-expand focus-ring"
              aria-expanded
              aria-label={t('tool.searchCollapseAria')}
              onClick={() => {
                restoreFocus.current = true
                setExpanded(false)
              }}
            >
              {t('tool.collapseResults')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Read-only fields are only values actually retained by Coko's tool contracts. */
export function StructuredToolBody({ item, fallback }: { item: ToolItem; fallback: React.ReactNode }) {
  const { t } = useI18n()
  if (item.status !== 'done' || !item.result || item.result.isError) return fallback
  const details = record(item.result.details)
  if (!details) return fallback
  let fields: { label: string; value: string }[] = []
  let caption: string
  let counts: React.ReactNode
  if (item.call.name === 'lsp') {
    const args = record(item.call.arguments) ?? {}
    const operation = string(details.operation) ?? string(args.operation)
    const file = string(details.file) ?? string(args.file_path)
    const line = details.line ?? args.line
    const character = details.character ?? args.character
    const { count, total, received } = details
    if (typeof operation !== 'string' || !['diagnostics', 'definition', 'references', 'hover'].includes(operation) || typeof file !== 'string') return fallback
    caption = t('tool.requestFields')
    fields = [
      { label: t('tool.operation'), value: operation },
      { label: t('tool.filePath'), value: file },
    ]
    if (nonnegative(line) && line > 0) fields.push({ label: t('tool.line'), value: String(line) })
    if (nonnegative(character) && character > 0) fields.push({ label: t('tool.character'), value: String(character) })
    if (nonnegative(count) && nonnegative(total) && count <= total)
      counts = (
        <p data-lsp-count={count} className="structured-detail-count">
          {received === false
            ? t('lsp.tool.notReceived')
            : total === 0
              ? t('lsp.tool.none')
              : count < total
                ? t('lsp.tool.truncated', { count, total })
                : t('lsp.tool.count', { count })}
        </p>
      )
  } else {
    const memory = record(details.memory)
    if (!memory || typeof memory.id !== 'string' || typeof memory.content !== 'string' || !['created', 'updated', 'deleted'].includes(String(details.action)))
      return fallback
    caption = t('memory.title')
    fields = [
      { label: t('tool.operation'), value: String(details.action) },
      { label: t('tool.identifier'), value: memory.id },
    ]
    if (typeof memory.scope === 'string') fields.push({ label: t('tool.scope'), value: memory.scope })
    fields.push({ label: t('memory.content'), value: memory.content })
  }
  return (
    <>
      <div className="structured-detail" data-structured-detail={item.call.name}>
        <div className="structured-detail-caption">{caption}</div>
        <ul className="structured-detail-list">
          <li className="structured-detail-item">
            <dl>
              {fields.map((field) => (
                <div className="structured-detail-field" key={field.label}>
                  <dt>{field.label}</dt>
                  <dd data-user-content>{field.value}</dd>
                </div>
              ))}
            </dl>
          </li>
        </ul>
        {counts}
        <div data-user-content className="structured-detail-output">
          {item.result.text === '' ? t('tool.noOutput') : item.result.text}
        </div>
      </div>
      <OriginalIO>{fallback}</OriginalIO>
    </>
  )
}
