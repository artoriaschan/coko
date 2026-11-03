import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import { resultText, type TimelineItem } from './timeline.ts'
type ToolItem = Extract<TimelineItem, { kind: 'tool' }>
const json = (value: unknown) => {
  if (value === undefined) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/** 未知工具：工具名为摘要，参数与结果按原样展示。 */
export function OriginalToolIO({ item }: { item: ToolItem }) {
  const { t } = useI18n()
  const result = item.result
    ? [item.result.text, json(item.result.details), json(item.result.structuredContent), json(item.result.content)].filter(Boolean).join('\n\n')
    : resultText(item.live?.partialResult)
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

export function OriginalIO({ children }: { children: React.ReactNode }) {
  const { t } = useI18n()
  return (
    <details className="structured-original">
      <summary className="focus-ring">{t('tool.originalIO')}</summary>
      {children}
    </details>
  )
}

export function ToolInspect({ onInspect }: { onInspect?: () => void }) {
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
