import { createTranslator, type Locale, type MessageKey } from '@coko/i18n'
import { toast } from '@coko/ui'
import type { ChatFailure } from '../stores/chat-store.ts'

const KIND_KEYS = {
  send: 'errors.sendFailed',
  stop: 'errors.stopFailed',
  retry: 'errors.retryFailed',
  workspace: 'errors.workspaceFailed',
} as const satisfies Record<ChatFailure['kind'], MessageKey>

/** 操作失败的提示文案：协议错误码有专门说明时用它，否则按操作类型。 */
export function failureMessage(locale: Locale, failure: ChatFailure): string {
  const t = createTranslator(locale)
  if (failure.error.code === 'model-not-configured') return t('errors.modelNotConfigured')
  if (failure.error.code === 'run-in-progress') return t('errors.runInProgress')
  return t(KIND_KEYS[failure.kind])
}

export function notifyFailure(locale: Locale, failure: ChatFailure): void {
  toast.error(failureMessage(locale, failure))
}
