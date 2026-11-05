import * as React from 'react'
import type { Theme } from '../../app/appearance-store.ts'
import { useI18n } from '../../app/i18n.tsx'
import { Markdown } from './markdown.tsx'
import './messages.css'
import { useProcessDisclosure } from './process-disclosure.tsx'

/** The locked reference's 16px think artwork; regular weight is a 1px stroke. */
function ThinkIcon() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1">
      <path d="M10.2854 5.71481C12.9673 8.39663 14.1182 11.5938 12.8562 12.8559C11.5942 14.1179 8.39706 12.9669 5.71518 10.2851C3.03333 7.60323 1.88236 4.40608 3.14441 3.14403C4.40644 1.882 7.6036 3.03297 10.2854 5.71481Z" />
      <path d="M10.2854 10.2851C7.6036 12.9669 4.40644 14.1179 3.14441 12.8559C1.88236 11.5938 3.03333 8.39663 5.71518 5.71481C8.39706 3.03297 11.5942 1.882 12.8562 3.14403C14.1182 4.40608 12.9673 7.60323 10.2854 10.2851Z" />
      <path
        stroke="none"
        fill="currentColor"
        d="M8.86291 8.0002C8.86291 8.47549 8.47762 8.86087 8.00224 8.86087C7.52694 8.86087 7.1416 8.47549 7.1416 8.0002C7.1416 7.52485 7.52694 7.13953 8.00224 7.13953C8.47762 7.13953 8.86291 7.52485 8.86291 8.0002Z"
      />
    </svg>
  )
}

/** A streaming preview advances only when a paragraph's first line has a newline. */
function preview(text: string, streaming: boolean): string {
  if (!streaming) return text.split('\n', 1)[0]!.replaceAll('**', '')
  let summary = ''
  const separator = /\r?\n(?:[\t ]*\r?\n)+/g
  let start = 0
  while (true) {
    const next = separator.exec(text)
    const end = next === null ? text.length : next.index + next[0].indexOf('\n')
    const newline = text.indexOf('\n', start)
    if (newline !== -1 && newline <= end) {
      const firstLine = text.slice(start, newline).trim()
      if (firstLine !== '') summary = firstLine
    }
    if (next === null) return summary.replaceAll('**', '')
    start = next.index + next[0].length
  }
}

/** Reasoning disclosure keeps its body mounted across streaming and settlement. */
export function ReasoningRow({
  text,
  streaming,
  theme,
  rootAttributes,
}: {
  text: string
  streaming: boolean
  theme: Theme
  rootAttributes?: Readonly<Record<`data-${string}`, string | number | undefined>>
}) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useProcessDisclosure()
  const id = React.useId()
  if (text.trim() === '') return null
  const summary = preview(text, streaming)
  return (
    <section
      {...rootAttributes}
      data-slot="reasoning"
      data-streaming={streaming || undefined}
      data-expanded={expanded || undefined}
      className="conversation-reasoning"
    >
      {streaming && <span className="sr-only">{t('tool.running')}</span>}
      <button
        type="button"
        aria-label={t('conversation.thinking')}
        aria-expanded={expanded}
        aria-controls={id}
        className="conversation-reasoning-toggle focus-ring rounded-sm"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="conversation-reasoning-leading">
          <span className="conversation-reasoning-icon">
            <ThinkIcon />
          </span>
          <svg aria-hidden className="conversation-reasoning-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1">
            <path
              d={
                expanded
                  ? 'M12 10L8.70711 6.70711C8.31658 6.31658 7.68342 6.31658 7.29289 6.70711L4 10'
                  : 'M4 6L7.29289 9.29289C7.68342 9.68342 8.31658 9.68342 8.70711 9.29289L12 6'
              }
            />
          </svg>
        </span>
        <span className="conversation-reasoning-labels">
          <span className="conversation-reasoning-title">{t('conversation.thinking')}</span>
          {!expanded && summary !== '' && (
            <>
              <span aria-hidden className="conversation-reasoning-separator" />
              <span data-slot="reasoning-summary" data-user-content className="conversation-reasoning-summary">
                {summary}
              </span>
            </>
          )}
          {streaming && (
            <span aria-hidden inert className="conversation-reasoning-shimmer">
              <span className="conversation-reasoning-sweep">
                <span className="conversation-reasoning-highlight">
                  <span data-shimmer-text={t('conversation.thinking')} className="conversation-reasoning-title" />
                  {!expanded && summary !== '' && (
                    <>
                      <span className="conversation-reasoning-separator" />
                      <span data-shimmer-text={summary} className="conversation-reasoning-summary" />
                    </>
                  )}
                </span>
              </span>
            </span>
          )}
        </span>
      </button>
      <div id={id} hidden={!expanded} data-user-content className="conversation-reasoning-body">
        <Markdown text={text} streaming={streaming} theme={theme} compact />
      </div>
    </section>
  )
}
