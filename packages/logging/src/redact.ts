import type { LogRecord, Sink } from '@logtape/logtape'
import { redactByField, type FieldPatterns, type RedactionPatterns } from '@logtape/redaction'

/** 替换敏感值的占位文本。 */
export const REDACTED = '[REDACTED]'

/** sidecar 会话 cookie 的名称（ADR 0002）；值属于脱敏字段。 */
export const SESSION_COOKIE_NAME = 'coko-session'

/**
 * 结构化字段名命中即替换值。只列凭据类字段：用量统计里的 inputTokens 等不应被删。
 */
export const SENSITIVE_FIELDS: FieldPatterns = [
  /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)$/i,
  /^(token|launchToken|accessToken|refreshToken|apiKey|api_key|key)$/i,
  /(password|passwd|secret|plaintext|ciphertext)$/i,
]

/** 自由文本中的凭据形态：Bearer 头、sk- 前缀密钥、会话 cookie、启动令牌、api-key 头。 */
export const SENSITIVE_PATTERNS: RedactionPatterns = [
  { pattern: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, replacement: `$1 ${REDACTED}` },
  { pattern: /\bsk-[A-Za-z0-9_-]{8,}/g, replacement: REDACTED },
  { pattern: new RegExp(`(${SESSION_COOKIE_NAME}=)[^;\\s"']+`, 'g'), replacement: `$1${REDACTED}` },
  { pattern: /((?:x-)?api-key["']?\s*[:=]\s*["']?)[^\s"',;]+/gi, replacement: `$1${REDACTED}` },
  // 32 字节 base64url（启动令牌、签名）：43 个字符且两侧不是 base64url 字符。
  { pattern: /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g, replacement: REDACTED },
]

// ---- 登记的 Secret 值（ADR 0007）----
// 宿主（Sidecar 的 SecretService）登记一个来源，给出当前已解密、在内存中的 Secret 值；redactText、文件日志与 redactSecretValues
// 在凭据形态之外再替换这些值。值不复制到这里，每次替换时现取。

/** 替换已登记 Secret 值的占位文本。 */
export const SECRET_REDACTED = '[REDACTED:secret]'
/** 更短的值替换后会误伤普通文本。 */
const MIN_SECRET_LENGTH = 4
const secretSources = new Set<() => readonly string[]>()

/** 登记一个 Secret 值来源；返回注销函数。 */
export function registerSecretValues(source: () => readonly string[]): () => void {
  secretSources.add(source)
  return () => void secretSources.delete(source)
}

function secretValues(): string[] {
  const values = new Set<string>()
  for (const source of secretSources)
    for (const value of source()) {
      if (value.length < MIN_SECRET_LENGTH) continue
      values.add(value)
      // JSON 中的转义形式（日志行、序列化后的条目）。
      const escaped = JSON.stringify(value).slice(1, -1)
      if (escaped !== value) values.add(escaped)
    }
  return [...values].sort((a, b) => b.length - a.length)
}

/** 只替换已登记的 Secret 值（不应用凭据形态规则）：用于工具结果等须保持原样的文本。 */
export function redactSecretValues(text: string): string {
  let result = text
  for (const value of secretValues()) result = result.replaceAll(value, SECRET_REDACTED)
  return result
}

/** 对一段自由文本替换已登记的 Secret 值并应用 SENSITIVE_PATTERNS。 */
export function redactText(text: string): string {
  let result = redactSecretValues(text)
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    result = typeof replacement === 'string' ? result.replaceAll(pattern, replacement) : result.replaceAll(pattern, replacement)
  }
  return result
}

/** 包装 sink：命中 SENSITIVE_FIELDS 的字段值替换为 REDACTED。 */
export function redactSink(sink: Sink): Sink {
  return redactByField(sink, { fieldPatterns: SENSITIVE_FIELDS, action: () => REDACTED })
}

/** 包装 sink：为每条记录附加固定属性（例如 process）。 */
export function withProperties(sink: Sink, properties: Readonly<Record<string, unknown>>): Sink {
  return (record: LogRecord) => sink({ ...record, properties: { ...properties, ...record.properties } })
}
