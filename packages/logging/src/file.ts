// Node 宿主入口：JSONL 文件 sink、按大小轮转与脱敏。只由 main / server 导入。
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { getRotatingFileSink } from '@logtape/file'
import { configure, dispose, getConsoleSink, getJsonLinesFormatter, type LogLevel, type Sink } from '@logtape/logtape'
import { redactByPattern } from '@logtape/redaction'
import { ROOT_CATEGORY } from './index.ts'
import { SENSITIVE_PATTERNS, redactSecretValues, redactSink, withProperties } from './redact.ts'

export interface FileLoggingOptions {
  /** 日志文件，例如 <logs>/sidecar.jsonl；目录不存在时以 0700 创建。 */
  path: string
  /** 写入每条记录的 process 字段，例如 sidecar、desktop。 */
  process: string
  /** 默认 info。 */
  level?: LogLevel
  /** 单文件上限，默认 10 MiB。 */
  maxSize?: number
  /** 保留的备份数，默认 5。 */
  maxFiles?: number
  /** 附加便于阅读的 console 输出（开发环境）。 */
  console?: boolean
  /** 写入每条记录的其他固定字段，例如 appVersion。 */
  properties?: Readonly<Record<string, unknown>>
}

export interface FileLogging {
  /** 文件 sink 无法建立时的原因；此时只有 console 诊断输出。 */
  readonly fileError?: Error
  /** 刷新并释放 sink。幂等。 */
  dispose(): Promise<void>
}

/**
 * 配置进程级 LogTape：coko.* 写入 JSONL 文件，字段与自由文本均脱敏。
 * 文件 sink 失败时退回 console 诊断路径，不递归写入同一个故障 sink。
 */
export async function configureFileLogging(options: FileLoggingOptions): Promise<FileLogging> {
  const level = options.level ?? 'info'
  // 装饰后的函数不再是 Disposable；转发 dispose，LogTape 才会在 dispose() 时刷新并关闭文件。
  const decorate = (sink: Sink): Sink => {
    const decorated = withProperties(redactSink(sink), { process: options.process, ...options.properties })
    const disposable = sink as Partial<Disposable & AsyncDisposable>
    if (disposable[Symbol.asyncDispose]) return Object.assign(decorated, { [Symbol.asyncDispose]: () => disposable[Symbol.asyncDispose]!() })
    if (disposable[Symbol.dispose]) return Object.assign(decorated, { [Symbol.dispose]: () => disposable[Symbol.dispose]!() })
    return decorated
  }
  const sinks: Record<string, Sink> = {
    // LogTape 自身的故障（例如 sink 写入失败）走 stderr。
    diagnostics: getConsoleSink({ console: { ...console, debug: console.error, info: console.error, log: console.error, warn: console.error } }),
  }
  let fileError: Error | undefined
  try {
    mkdirSync(dirname(options.path), { recursive: true, mode: 0o700 })
    const patterned = redactByPattern(getJsonLinesFormatter({ properties: 'nest:properties' }), SENSITIVE_PATTERNS)
    // 已登记的 Secret 值（ADR 0007）在凭据形态之外一并替换。
    const formatter = (record: Parameters<typeof patterned>[0]) => redactSecretValues(patterned(record))
    sinks.file = decorate(getRotatingFileSink(options.path, { formatter, maxSize: options.maxSize ?? 10 * 1024 * 1024, maxFiles: options.maxFiles ?? 5 }))
  } catch (error) {
    fileError = error instanceof Error ? error : new Error(String(error))
    console.error(`[coko] log file unavailable at ${options.path}: ${fileError.message}`)
  }
  if (options.console || fileError) sinks.console = decorate(getConsoleSink())
  const appSinks = Object.keys(sinks).filter((id) => id !== 'diagnostics')
  await configure({
    reset: true,
    sinks,
    loggers: [
      { category: [ROOT_CATEGORY], sinks: appSinks, lowestLevel: level },
      { category: ['logtape', 'meta'], sinks: ['diagnostics'], lowestLevel: 'warning' },
    ],
  })
  let disposing: Promise<void> | undefined
  return {
    ...(fileError ? { fileError } : {}),
    dispose: () => (disposing ??= dispose()),
  }
}
