// Adapted from DeepSeek Harness (MIT), Copyright (c) 2026 DeepSeek.
import { Button } from '@coko/ui'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import { diagnosticJson } from './raw-json.ts'

function JsonBranch({ value, name }: { value: unknown; name: string }) {
  const [expanded, setExpanded] = React.useState(true)
  if (value === null || typeof value !== 'object')
    return (
      <li>
        <span className="text-muted-foreground">{name}: </span>
        {JSON.stringify(value) ?? String(value)}
      </li>
    )
  const entries = Object.entries(value)
  return (
    <li>
      <details open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
        <summary className="cursor-pointer text-muted-foreground">
          {name}: {Array.isArray(value) ? `[${entries.length}]` : '{…}'}
        </summary>
        {expanded && (
          <ul className="ps-4">
            {entries.map(([key, child]) => (
              <JsonBranch key={key} value={child} name={key} />
            ))}
          </ul>
        )}
      </details>
    </li>
  )
}

/** 原始数据先安全序列化；JSON 树的所有容器默认展开。运行时对象树由对话分组提供。 */
export function RecordDetails({
  recordKey,
  value,
  removed,
  onClose,
  children,
}: {
  recordKey: string
  value: unknown
  removed: boolean
  onClose: () => void
  children?: React.ReactNode
}) {
  const { t } = useI18n()
  const [percent, setPercent] = React.useState(40)
  const root = React.useRef<HTMLDivElement>(null)
  const drag = React.useRef<{ id: number; y: number; height: number; available: number } | null>(null)
  const serialized = React.useMemo(() => (children === undefined ? diagnosticJson(value) : { text: '', failed: false }), [value, children])
  const parsed = React.useMemo<unknown>(() => (serialized.failed || serialized.text === '' ? undefined : JSON.parse(serialized.text)), [serialized])
  const clamp = (next: number) => Math.max(15, Math.min(80, next))
  const resize = (event: React.PointerEvent<HTMLElement>) => {
    const start = drag.current
    if (start?.id !== event.pointerId) return
    setPercent(clamp(((start.height + start.y - event.clientY) / start.available) * 100))
  }
  return (
    <div
      ref={root}
      role="region"
      aria-label={t('diagnostics.details')}
      className="relative flex min-h-0 shrink-0 flex-col border-t-hairline bg-background"
      style={{ height: `${percent}%` }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={t('diagnostics.resizeDetails')}
        aria-valuemin={15}
        aria-valuemax={80}
        aria-valuenow={Math.round(percent)}
        tabIndex={0}
        className="absolute inset-x-0 top-0 z-10 h-2 -translate-y-1/2 cursor-row-resize touch-none focus-ring"
        data-window-no-drag
        onPointerDown={(event) => {
          if (event.button !== 0 || drag.current) return
          const element = root.current
          const available = element?.parentElement?.getBoundingClientRect().height ?? 0
          if (!element || !available) return
          event.preventDefault()
          event.currentTarget.focus()
          drag.current = { id: event.pointerId, y: event.clientY, height: element.getBoundingClientRect().height, available }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={resize}
        onPointerUp={(event) => {
          resize(event)
          drag.current = null
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
        onLostPointerCapture={() => {
          drag.current = null
        }}
        onKeyDown={(event) => {
          const next =
            event.key === 'ArrowUp' ? percent + 5 : event.key === 'ArrowDown' ? percent - 5 : event.key === 'Home' ? 15 : event.key === 'End' ? 80 : null
          if (next === null) return
          event.preventDefault()
          setPercent(clamp(next))
        }}
      />
      <div className="flex shrink-0 items-center justify-between px-3 py-1 text-ui-caption text-muted-foreground">
        <span>{t('diagnostics.details')}</span>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t('diagnostics.closeDetails')}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3 text-ui-caption font-mono" data-scroll-stable>
        {removed ? (
          <p role="status">{t('diagnostics.removed')}</p>
        ) : (
          (children ??
          (serialized.failed ? (
            <p role="alert">{t('diagnostics.serializationFailed')}</p>
          ) : (
            <ul>
              <JsonBranch key={recordKey} value={parsed} name="$" />
            </ul>
          )))
        )}
      </div>
    </div>
  )
}
