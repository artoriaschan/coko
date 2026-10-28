// main 的桌面日志：<logs>/desktop.jsonl（单写者、轮转、脱敏），以及 renderer 经受控 IPC 转发的日志。
import { getLogger, type LogLevel } from '@coko/logging'
import { configureFileLogging, type FileLogging } from '@coko/logging/file'

export const DESKTOP_LOG_FILE = 'desktop.jsonl'

/** 一条转发日志序列化后的上限；超过则丢弃整条。 */
export const MAX_RENDERER_LOG_BYTES = 16 * 1024

const LEVELS: ReadonlySet<string> = new Set<LogLevel>(['trace', 'debug', 'info', 'warning', 'error', 'fatal'])
/** 由 main 标记的字段，renderer 提供的同名属性被丢弃。 */
const RESERVED = new Set(['source', 'process', 'appVersion'])

export interface RendererLogRecord {
  readonly level: LogLevel
  readonly message: string
  readonly category: readonly string[]
  readonly properties: Readonly<Record<string, unknown>>
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** 校验 renderer 发来的日志；不合规返回 undefined（调用方丢弃，不抛给 renderer）。 */
export function parseRendererLog(raw: unknown): RendererLogRecord | undefined {
  if (!isRecord(raw)) return undefined
  const { level, message, category = [], properties = {} } = raw
  if (typeof level !== 'string' || !LEVELS.has(level) || typeof message !== 'string') return undefined
  if (!Array.isArray(category) || category.length > 4 || !category.every((part) => typeof part === 'string' && part.length > 0 && part.length <= 64))
    return undefined
  if (!isRecord(properties)) return undefined
  let size: number
  try {
    size = Buffer.byteLength(JSON.stringify({ message, category, properties }))
  } catch {
    return undefined
  }
  if (size > MAX_RENDERER_LOG_BYTES) return undefined
  const safe = Object.fromEntries(Object.entries(properties).filter(([key]) => !RESERVED.has(key)))
  return { level: level as LogLevel, message, category: category as string[], properties: safe }
}

/** 写入一条已校验的 renderer 日志，分类为 coko.renderer.*，source 由 main 标记。 */
export function writeRendererLog(record: RendererLogRecord): void {
  const logger = getLogger(['renderer', ...record.category])
  // LogTape 把消息当作模板解析花括号；转义后原文照写，renderer 文本不会被当作占位符。
  const template = record.message.replaceAll('{', '{{').replaceAll('}', '}}')
  const properties = { ...record.properties, source: 'renderer' }
  switch (record.level) {
    case 'trace':
      return logger.trace(template, properties)
    case 'debug':
      return logger.debug(template, properties)
    case 'info':
      return logger.info(template, properties)
    case 'warning':
      return logger.warn(template, properties)
    case 'error':
      return logger.error(template, properties)
    case 'fatal':
      return logger.fatal(template, properties)
  }
}

/** 配置 main 进程的 LogTape：desktop.jsonl。返回值的 dispose 在退出前调用以刷新。 */
export function startDesktopLogging(options: { logPath: string; appVersion: string; console: boolean }): Promise<FileLogging> {
  return configureFileLogging({
    path: options.logPath,
    process: 'desktop',
    console: options.console,
    properties: { appVersion: options.appVersion },
  })
}
