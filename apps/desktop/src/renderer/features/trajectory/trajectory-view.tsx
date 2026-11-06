import { Button } from '@coko/ui'
import { LoaderCircleIcon } from 'lucide-react'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import { useReloadOnEntryCount } from '../conversation/use-reload-on-entry-count.ts'
import { useTrace, useTraceStoreApi } from '../conversation/session-download.tsx'
import { TrajectoryPanel } from './trajectory-panel.tsx'

/** 影响追踪的条目：数量变化时重读。 */
const TRACE_ENTRY_KINDS = ['model_request', 'run_start', 'run_end', 'message', 'tool_exec', 'approval_request', 'approval_decision', 'hook_run'] as const

/** 同一帧内的多次变化合并为一次读取。 */
function useFrameLoad(load: (sessionId: string) => Promise<void>) {
  const frame = React.useRef<number | undefined>(undefined)
  React.useEffect(() => () => (frame.current === undefined ? undefined : cancelAnimationFrame(frame.current)), [])
  return React.useCallback(
    (sessionId: string) => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current)
      frame.current = requestAnimationFrame(() => {
        frame.current = undefined
        void load(sessionId)
      })
    },
    [load],
  )
}

export function TrajectoryView({ sessionId }: { sessionId: string }) {
  const { t } = useI18n()
  const store = useTraceStoreApi()
  const scheduleLoad = useFrameLoad(store.getState().load)
  useReloadOnEntryCount(sessionId, TRACE_ENTRY_KINDS, scheduleLoad)
  const trace = useTrace((s) => s.sessions[sessionId])
  const centered = 'flex min-h-0 flex-1 items-center justify-center p-6 text-center text-ui-body text-muted-foreground'
  const response = trace?.response
  if (!response) {
    if (trace?.status === 'error')
      return (
        <div className={`${centered} flex-col gap-2`}>
          <p>{t('trace.loadFailed')}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void store.getState().load(sessionId)}>
            {t('trace.retry')}
          </Button>
        </div>
      )
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center" aria-label={t('trace.loading')}>
        <LoaderCircleIcon aria-hidden className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none" />
      </div>
    )
  }
  return (
    <div data-slot="trace-tab" className="flex min-h-0 min-w-0 flex-1 flex-col">
      {trace?.status === 'error' && (
        <p role="status" className="shrink-0 px-4 pb-2 text-ui-small text-destructive">
          {t('trace.loadFailed')}
        </p>
      )}
      <TrajectoryPanel key={sessionId} sessionId={sessionId} runs={response.runs} />
    </div>
  )
}
