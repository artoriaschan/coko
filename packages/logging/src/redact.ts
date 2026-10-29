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

// ---- 登记的明文值（ADR 0004、0007）----
// 宿主登记来源，给出当前已解密、在内存中的明文：SecretService 登记 Secret 值，Credential 存储登记 Provider 密钥。redactText、文件日志与
// redactSecretValues 在凭据形态之外再替换这些值。值不复制到这里，每次替换时现取。

/** 替换已登记 Secret 值的占位文本。 */
export const SECRET_REDACTED = '[REDACTED:secret]'
/** 更短的值替换后会误伤普通文本。 */
const MIN_SECRET_LENGTH = 4

interface SecretSource {
  values: () => readonly string[]
  replacement: string
}
const secretSources = new Set<SecretSource>()

/**
 * 登记一个明文来源；返回注销函数。replacement 缺省为 SECRET_REDACTED（Secret）；Credential 用 REDACTED，与凭据形态的替换文本相同。
 */
export function registerSecretValues(source: () => readonly string[], options: { replacement?: string } = {}): () => void {
  const entry: SecretSource = { values: source, replacement: options.replacement ?? SECRET_REDACTED }
  secretSources.add(entry)
  return () => void secretSources.delete(entry)
}

/** 当前的全部替换对（含 JSON 转义形式），长的在前：一个值是另一个值的一部分时先替换长的。 */
function secretPairs(): [value: string, replacement: string][] {
  const pairs = new Map<string, string>()
  for (const source of secretSources)
    for (const value of source.values()) {
      if (value.length < MIN_SECRET_LENGTH) continue
      if (!pairs.has(value)) pairs.set(value, source.replacement)
      // JSON 中的转义形式（日志行、序列化后的条目）。
      const escaped = JSON.stringify(value).slice(1, -1)
      if (escaped !== value && !pairs.has(escaped)) pairs.set(escaped, source.replacement)
    }
  return [...pairs].sort((a, b) => b[0].length - a[0].length)
}

const replacePairs = (text: string, pairs: readonly [string, string][]) => {
  let result = text
  for (const [value, replacement] of pairs) if (result.includes(value)) result = result.replaceAll(value, replacement)
  return result
}

/** 只替换已登记的明文（不应用凭据形态规则）：用于工具结果、模型输出等须保持原样的文本。 */
export function redactSecretValues(text: string): string {
  return replacePairs(text, secretPairs())
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * 递归替换值中所有字符串里已登记的明文（数组与普通对象，含键名之外的全部字符串）。没有任何替换时返回原值（同一引用），
 * 调用方可据此判断是否需要改写。
 */
export function redactSecretsDeep<T>(value: T): T {
  const pairs = secretPairs()
  if (pairs.length === 0) return value
  const walk = (inner: unknown): unknown => {
    if (typeof inner === 'string') return replacePairs(inner, pairs)
    if (Array.isArray(inner)) {
      let changed = false
      const next = inner.map((item) => {
        const replaced = walk(item)
        if (replaced !== item) changed = true
        return replaced
      })
      return changed ? next : inner
    }
    if (isPlainObject(inner)) {
      let changed = false
      const next: Record<string, unknown> = {}
      for (const [key, item] of Object.entries(inner)) {
        const replaced = walk(item)
        if (replaced !== item) changed = true
        next[key] = replaced
      }
      return changed ? next : inner
    }
    return inner
  }
  return walk(value) as T
}

/**
 * 流式文本的按值替换：一个值可能跨多个增量到达。push 返回可以立即发出的部分（已替换）；结尾若可能是某个登记值的开头，先留在缓冲中，
 * 等后续增量确定。flush 返回留下的部分（替换后）。不同内容块各用一个实例。
 */
export interface SecretStreamRedactor {
  push(delta: string): string
  flush(): string
}

export function createSecretStreamRedactor(): SecretStreamRedactor {
  let pending = ''
  return {
    push(delta) {
      const pairs = secretPairs()
      if (pairs.length === 0) {
        const out = pending + delta
        pending = ''
        return out
      }
      const text = replacePairs(pending + delta, pairs)
      // 留下最长的、是某个登记值真前缀的结尾。
      let hold = 0
      for (const [value] of pairs) {
        const max = Math.min(value.length - 1, text.length)
        for (let n = max; n > hold; n--)
          if (text.endsWith(value.slice(0, n))) {
            hold = n
            break
          }
      }
      pending = text.slice(text.length - hold)
      return text.slice(0, text.length - hold)
    },
    flush() {
      const out = redactSecretValues(pending)
      pending = ''
      return out
    },
  }
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
