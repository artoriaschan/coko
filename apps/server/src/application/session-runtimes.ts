import { lastRunStatus, type AgentRuntime, type ProgressEvent as AgentProgress, type RunEntry, type RunStatus } from '@coko/agent'
import { redactSecretsDeep, redactText } from '@coko/logging'
import type { ProgressEvent } from '@coko/protocol'
import type { JsonValue, NewSessionEntry, SessionEntry as StoredEntry, Session as StoredSession, SessionStore } from '@coko/session'
import { AppError } from './errors.ts'
import type { SessionHub } from './hub.ts'

const toJson = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue

/**
 * 模型服务的错误文本可能回显请求凭据（例如 "Incorrect API key provided: sk-…"），入库与推送前都按凭据形态与登记明文脱敏
 * （ADR 0004）。
 */
const redactModelError = redactText

/**
 * 运行时条目按注册的 kind 提交（session 校验 payload）。回显模型错误的字段按凭据形态脱敏；除用户消息外的全部 payload（模型输出的
 * 文本与工具调用参数、工具结果、压缩摘要、审批对象、执行记录）再替换登记的明文（secret-redaction.ts 的第二道防线）。
 * 用户输入的文本保持原样（ADR 0007）。
 */
export function toNewEntry(entry: RunEntry): NewSessionEntry {
  let payload: unknown = entry.payload
  if (entry.kind === 'message' && entry.payload.role === 'assistant' && entry.payload.errorMessage) {
    payload = { ...entry.payload, errorMessage: redactModelError(entry.payload.errorMessage) }
  } else if (entry.kind === 'run_end' && entry.payload.error) {
    payload = { ...entry.payload, error: { ...entry.payload.error, message: redactModelError(entry.payload.error.message) } }
  }
  const json = toJson(payload)
  const userInput = entry.kind === 'message' && entry.payload.role === 'user'
  return { kind: entry.kind, ...(entry.runId === undefined ? {} : { runId: entry.runId }), payload: userInput ? json : redactSecretsDeep(json) }
}

/** 进度的协议形状：回显模型错误的字段按凭据形态脱敏（登记明文的替换由调用方先经 createProgressRedactor 完成）。 */
export function toProgress(event: AgentProgress): ProgressEvent {
  const { runId: _runId, ...rest } = event
  if (rest.type === 'retry') return { ...rest, errorMessage: redactModelError(rest.errorMessage) }
  if (rest.type === 'compaction_failed') return { ...rest, message: redactModelError(rest.message) }
  if (rest.type === 'run_end' && rest.error) return { ...rest, error: { ...rest.error, message: redactModelError(rest.error.message) } }
  return toJson(rest) as ProgressEvent
}

/** 读取 Session；不存在时 not-found。 */
export async function requireSession(store: SessionStore, sessionId: string): Promise<StoredSession> {
  const session = await store.sessions.getSession(sessionId)
  if (!session) throw new AppError('not-found', `Session ${sessionId} not found`)
  return session
}

/**
 * Session 运行时注册表：正在创建或已创建的运行时、各自的条目发布函数（含扩展的 onEntry），以及已知的上一 Run 结束状态
 * （读过条目或本进程内结束的 Run；用于 Session 不在运行时的 activity）。
 */
export class SessionRuntimes {
  readonly #store: SessionStore
  readonly #hub: SessionHub
  /** 正在创建或已创建的运行时；创建失败时移除。 */
  readonly #pending = new Map<string, Promise<AgentRuntime>>()
  readonly #runtimes = new Map<string, AgentRuntime>()
  /** 运行时的条目发布（含扩展的 onEntry）；没有运行时的 Session 直接提交并发布。 */
  readonly #publishers = new Map<string, (entry: RunEntry) => Promise<StoredEntry>>()
  readonly #lastStatus = new Map<string, RunStatus>()

  constructor(store: SessionStore, hub: SessionHub) {
    this.#store = store
    this.#hub = hub
  }

  get(sessionId: string): AgentRuntime | undefined {
    return this.#runtimes.get(sessionId)
  }

  /** 已建立的运行时（重新判定待审批请求时遍历）。 */
  entries(): IterableIterator<[string, AgentRuntime]> {
    return this.#runtimes.entries()
  }

  isRunning(sessionId: string): boolean {
    return this.#runtimes.get(sessionId)?.isRunning ?? false
  }

  activeRuns(): number {
    let count = 0
    for (const runtime of this.#runtimes.values()) if (runtime.isRunning) count++
    return count
  }

  /** 取得或创建运行时（并发的调用共用同一次创建）。 */
  obtain(sessionId: string, create: () => Promise<AgentRuntime>): Promise<AgentRuntime> {
    const existing = this.#pending.get(sessionId)
    if (existing) return existing
    const created = create()
    this.#pending.set(sessionId, created)
    created.then(
      (runtime) => this.#runtimes.set(sessionId, runtime),
      () => this.#pending.delete(sessionId),
    )
    return created
  }

  /** 丢弃未在运行的运行时：之后开始 Run 时从条目重建（有效上下文、锚点与权限状态）。 */
  discard(sessionId: string): void {
    const runtime = this.#runtimes.get(sessionId)
    if (runtime?.isRunning) return
    this.#runtimes.delete(sessionId)
    this.#pending.delete(sessionId)
    this.#publishers.delete(sessionId)
  }

  /**
   * 运行时的条目发布函数并登记（之后 commit 经它提交）：提交、记下 run_end 状态、经 hub 推送，再调用 onEntry。
   * onEntry 每次现取（扩展在发布函数之后创建）。
   */
  publisher(sessionId: string, onEntry: () => ((entry: StoredEntry) => void) | undefined): (entry: RunEntry) => Promise<StoredEntry> {
    const publish = async (entry: RunEntry): Promise<StoredEntry> => {
      const [committed] = await this.#store.sessions.appendEntries(sessionId, [toNewEntry(entry)])
      if (entry.kind === 'run_end') this.#lastStatus.set(sessionId, entry.payload.status)
      this.#hub.publishEntry(committed!)
      onEntry()?.(committed!)
      return committed!
    }
    this.#publishers.set(sessionId, publish)
    return publish
  }

  /** 提交并发布一条条目：有运行时时经其发布函数（扩展能观察到），否则直接提交并发布。 */
  async commit(sessionId: string, entry: RunEntry): Promise<StoredEntry> {
    const publish = this.#publishers.get(sessionId)
    if (publish) return publish(entry)
    const [committed] = await this.#store.sessions.appendEntries(sessionId, [toNewEntry(entry)])
    this.#hub.publishEntry(committed!)
    return committed!
  }

  /** 一次事务提交一批条目，之后逐条发布（没有运行时扩展的场景）。 */
  async commitBatch(sessionId: string, entries: readonly RunEntry[]): Promise<StoredEntry[]> {
    const committed = await this.#store.sessions.appendEntries(sessionId, entries.map(toNewEntry))
    for (const entry of committed) {
      if (entry.kind === 'run_end') this.#lastStatus.set(sessionId, (entry.payload as { status: RunStatus }).status)
      this.#hub.publishEntry(entry)
    }
    return committed
  }

  lastStatus(sessionId: string): RunStatus | undefined {
    return this.#lastStatus.get(sessionId)
  }

  setLastStatus(sessionId: string, status: RunStatus): void {
    this.#lastStatus.set(sessionId, status)
  }

  /** 按条目重算上一 Run 状态（被回退的 Run 不算）。 */
  rememberStatus(sessionId: string, entries: readonly StoredEntry[]): void {
    const status = lastRunStatus(entries)
    if (status) this.#lastStatus.set(sessionId, status)
    else this.#lastStatus.delete(sessionId)
  }
}
