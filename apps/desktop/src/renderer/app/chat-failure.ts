import { createTranslator, type Locale, type MessageKey } from '@coko/i18n'
import { toast } from '@coko/ui'
import type { ChatFailure } from '../stores/chat-store.ts'

const KIND_KEYS = {
  send: 'errors.sendFailed',
  stop: 'errors.stopFailed',
  retry: 'errors.retryFailed',
  workspace: 'errors.workspaceFailed',
  model: 'errors.modelSwitchFailed',
  approval: 'errors.approvalFailed',
  permissions: 'errors.permissionsFailed',
  steer: 'errors.steerFailed',
  pause: 'errors.pauseFailed',
  continue: 'errors.continueFailed',
  confirmation: 'errors.confirmationFailed',
  rewind: 'errors.rewindFailed',
  fork: 'errors.forkFailed',
} as const satisfies Record<ChatFailure['kind'], MessageKey>

/** 操作失败的提示文案：协议错误码有专门说明时用它，否则按操作类型。 */
export function failureMessage(locale: Locale, failure: ChatFailure): string {
  const t = createTranslator(locale)
  if (failure.error.code === 'model-not-configured') return t('errors.modelNotConfigured')
  if (failure.error.code === 'run-in-progress') return t('errors.runInProgress')
  if (failure.error.code === 'approval-not-pending') return t('errors.approvalNotPending')
  if (failure.error.code === 'no-active-run') return t('errors.noActiveRun')
  if (failure.error.code === 'nothing-to-continue') return t('errors.nothingToContinue')
  if (failure.error.code === 'confirmation-pending') return t('errors.confirmationPending')
  if (failure.error.code === 'session-busy') return t('errors.sessionBusy')
  return t(KIND_KEYS[failure.kind])
}

/** 未配置模型时 Toast 带"打开设置"入口。 */
export function notifyFailure(locale: Locale, failure: ChatFailure, openModels?: () => void): void {
  const action =
    failure.error.code === 'model-not-configured' && openModels ? { action: { label: createTranslator(locale)('settings.open'), onClick: openModels } } : {}
  toast.error(failureMessage(locale, failure), action)
}
