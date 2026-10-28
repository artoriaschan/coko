import { cn } from '@coko/ui'
import type { ConnectionPhase, ConnectionState } from '../../client/connection.ts'
import { useI18n } from '../../app/i18n.tsx'

const dotClass: Record<ConnectionPhase, string> = {
  connecting: 'bg-muted-foreground',
  connected: 'bg-success',
  disconnected: 'bg-muted-foreground',
  failed: 'bg-destructive',
}

/** 中栏标题行的 Sidecar 连接指示；role=status 与 data-connection 供读屏与 E2E 观测连接阶段。 */
export function ConnectionStatus({ state }: { state: ConnectionState }) {
  const { t } = useI18n()
  const label = t(`connection.${state.phase}`)
  // 窄中栏（含侧栏收起动画期间）先截断文案、保留状态点，完整文案经 title 查看。
  return (
    <p role="status" data-connection={state.phase} title={label} className="flex min-w-0 items-center gap-1.5 text-ui-small text-muted-foreground">
      <span aria-hidden className={cn('size-2 shrink-0 rounded-round', dotClass[state.phase])} />
      <span className="min-w-0 truncate">{label}</span>
    </p>
  )
}

/** 启动失败时覆盖对话区：简短说明在前，技术详情保持原文并可选中复制（与用户内容一样不经字典，故标记 data-user-content）。 */
export function ConnectionFailure({ code, message }: { code: string; message: string }) {
  const { t } = useI18n()
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-background p-6 text-center">
      <p className="text-ui-body-lg font-medium">{t('connection.failed')}</p>
      <p data-error-code={code} data-user-content className="max-w-120 text-ui-small break-words text-muted-foreground select-text">
        {message} ({code})
      </p>
    </div>
  )
}
