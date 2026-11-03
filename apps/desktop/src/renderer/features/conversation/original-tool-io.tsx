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
