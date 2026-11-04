import { toast } from '@coko/ui'
import * as React from 'react'
import { useStore } from 'zustand'
import { useI18n } from '../../app/i18n.tsx'
import { traceStore, type TraceStore, type TraceActions, type TraceState } from '../../stores/trace-store.ts'

const TraceStoreContext = React.createContext<TraceStore>(traceStore)

export function TraceStoreProvider({ store, children }: { store: TraceStore; children: React.ReactNode }) {
  return <TraceStoreContext.Provider value={store}>{children}</TraceStoreContext.Provider>
}

export const useTraceStoreApi = (): TraceStore => React.useContext(TraceStoreContext)
export function useTrace<T>(selector: (state: TraceState & TraceActions) => T): T {
  return useStore(useTraceStoreApi(), selector)
}

/** Trace 导出与 Session 下载共用同一个请求锁、下载与反馈。 */
export function useSessionDownload(sessionId: string, extension?: 'jsonl') {
  const { t } = useI18n()
  const store = useTraceStoreApi()
  const exporting = useTrace((state) => state.exporting[sessionId] ?? false)
  const download = async () => {
    try {
      const file = await store.getState().exportSession(sessionId)
      if (!file) return
      const filename = extension === 'jsonl' ? `coko-session-${sessionId}.jsonl` : file.filename
      const url = URL.createObjectURL(new Blob([file.text], { type: 'application/x-ndjson' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = filename
        document.body.append(link)
        try {
          link.click()
        } finally {
          link.remove()
        }
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 0)
      }
      toast.success(t('trace.exported', { filename }))
    } catch (error) {
      toast.error(t('trace.exportFailed', { message: error instanceof Error ? error.message : String(error) }))
    }
  }
  return { exporting, download }
}
