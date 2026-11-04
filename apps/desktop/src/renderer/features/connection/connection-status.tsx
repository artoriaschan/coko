import { Button } from '@coko/ui'
import { FolderOpenIcon } from 'lucide-react'
import { RENDERER_FAILURE_CODES, type ConnectionState } from '../../client/connection.ts'
import { useI18n } from '../../app/i18n.tsx'

const REASON_KEYS = {
  'no-bridge': 'connection.reasons.noBridge',
  health: 'connection.reasons.health',
  'ws-timeout': 'connection.reasons.wsTimeout',
  renderer: 'connection.reasons.renderer',
} as const satisfies Record<(typeof RENDERER_FAILURE_CODES)[number], string>

const isRendererCode = (code: string): code is keyof typeof REASON_KEYS => (RENDERER_FAILURE_CODES as readonly string[]).includes(code)

/** 仅供辅助技术播报；常驻新对话与详情页，保留 data-connection 作为 E2E 的就绪信号。 */
export function ConnectionStatus({ state }: { state: ConnectionState }) {
  const { t } = useI18n()
  const label = t(`connection.${state.phase}`)
  return (
    <p role="status" aria-label={label} aria-atomic="true" data-connection={state.phase} className="sr-only">
      {label}
    </p>
  )
}

export interface ConnectionFailureProps {
  code: string
  message: string
  /** Sidecar 运行后退出且重启用尽。 */
  crashed?: boolean
  /** 诊断入口：打开日志文件夹；桥接不可用时不提供。 */
  onOpenLogs?: (() => void) | undefined
}

/**
 * 启动失败或重启用尽时覆盖对话区：简短说明在前；renderer 自己判定的失败给出字典中的原因。技术详情保持原文并可选中复制
 * （与用户内容一样不经字典，故标记 data-user-content）；提供打开日志文件夹的诊断入口。
 */
export function ConnectionFailure({ code, message, crashed = false, onOpenLogs }: ConnectionFailureProps) {
  const { t } = useI18n()
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-background p-6 text-center">
      <p className="text-ui-body-lg font-medium">{t(crashed ? 'connection.crashed' : 'connection.failed')}</p>
      {isRendererCode(code) && <p className="max-w-120 text-ui-body">{t(REASON_KEYS[code])}</p>}
      <p data-error-code={code} data-user-content className="max-w-120 text-ui-small break-words text-muted-foreground select-text">
        {message} ({code})
      </p>
      {onOpenLogs && (
        <Button variant="outline" size="sm" className="mt-2" onClick={onOpenLogs}>
          <FolderOpenIcon />
          {t('connection.openLogs')}
        </Button>
      )}
    </div>
  )
}
