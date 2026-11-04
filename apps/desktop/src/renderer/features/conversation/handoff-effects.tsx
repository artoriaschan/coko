import type { MessageKey } from '@coko/i18n'
import { toast } from '@coko/ui'
import * as React from 'react'
import { useStore } from 'zustand'
import { useChatStoreApi } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { ApiError } from '../../client/api.ts'
import { handoffStore as defaultHandoffStore, type HandoffStore } from '../../stores/handoff-store.ts'

const HandoffStoreContext = React.createContext<HandoffStore>(defaultHandoffStore)

/** 测试注入交接 store；生产界面使用同一个常驻实例。 */
export function HandoffStoresProvider({ handoff, children }: { handoff: HandoffStore; children: React.ReactNode }) {
  return <HandoffStoreContext.Provider value={handoff}>{children}</HandoffStoreContext.Provider>
}

export const HANDOFF_ERRORS: Partial<Record<string, MessageKey>> = {
  'nothing-to-hand-off': 'handoff.errors.nothing',
  'run-in-progress': 'handoff.errors.running',
  'child-session': 'handoff.errors.childSession',
  'not-a-git-repo': 'handoff.errors.notARepo',
  'invalid-name': 'handoff.errors.invalidName',
  'worktree-exists': 'handoff.errors.exists',
  'worktree-removed': 'handoff.errors.removed',
  'unsafe-worktree-path': 'handoff.errors.unsafePath',
}

/** 常驻对话区：完成后写摘要草稿并按源会话切换；目标创建失败时报告一次并按原目标重试。 */
export function HandoffEffects() {
  const store = React.useContext(HandoffStoreContext)
  const chat = useChatStoreApi()
  const { t } = useI18n()
  React.useEffect(() => store.getState().attach(chat), [chat, store])
  const progress = useStore(store, (s) => s.progress)
  const reported = React.useRef(new Set<string>())
  React.useEffect(() => {
    for (const [sessionId, state] of Object.entries(progress)) {
      const key = `${sessionId}:${state.runId}`
      if (state.phase !== 'failed' || reported.current.has(key)) continue
      reported.current.add(key)
      const failed = chat.getState().conversations[sessionId]?.entries.findLast((entry) => entry.kind === 'handoff_failed' && entry.runId === state.runId)
      const instructions = failed?.kind === 'handoff_failed' ? failed.payload.instructions : undefined
      const reason = HANDOFF_ERRORS[state.error.code]
      toast.error(t('handoff.failed'), {
        ...(reason ? { description: t(reason) } : {}),
        ...(instructions
          ? {
              action: {
                label: t('handoff.retry'),
                onClick: () => {
                  void store
                    .getState()
                    .start(sessionId, { instructions, target: { kind: 'current' } })
                    .catch((error: unknown) => {
                      const key = error instanceof ApiError ? HANDOFF_ERRORS[error.code] : undefined
                      toast.error(t(key ?? 'handoff.errors.failed'))
                    })
                },
              },
            }
          : {}),
      })
    }
  }, [chat, progress, store, t])
  return null
}
