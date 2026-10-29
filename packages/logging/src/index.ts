// 运行时无关入口：业务代码只经这里取 logger。文件 sink 在 @coko/logging/file，由 main / server 装配。
import { getLogger as getLogTapeLogger, type Logger } from '@logtape/logtape'

export type { Logger, LogLevel } from '@logtape/logtape'
export {
  REDACTED,
  SECRET_REDACTED,
  SENSITIVE_FIELDS,
  SENSITIVE_PATTERNS,
  SESSION_COOKIE_NAME,
  redactSecretValues,
  redactSink,
  redactText,
  registerSecretValues,
  withProperties,
} from './redact.ts'

/** 所有 Coko 日志的根分类。 */
export const ROOT_CATEGORY = 'coko'

/** 取得 coko.<category> 的 logger；宿主未配置 sink 时调用是空操作。 */
export function getLogger(category: string | readonly string[] = []): Logger {
  return getLogTapeLogger([ROOT_CATEGORY, ...(typeof category === 'string' ? [category] : category)])
}
