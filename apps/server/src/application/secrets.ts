// 登记的 Secret（ADR 0007）：列表与删除（/api/secrets）、经控制 IPC secret.store 登记、按名字解析（MCP 配置的 ${NAME} 与工具声明的
// Secrets），以及按已解密的值脱敏（MCP 的 stderr 与诊断）。值不经过 HTTP，也不写日志。
import type { SecretProvider } from '@coko/agent'
import { getLogger, redactSecretValues, redactText, registerSecretValues } from '@coko/logging'
import { SECRET_NAME_PATTERN, type SecretsResponse } from '@coko/protocol'
import type { SessionStore } from '@coko/session'
import type { SecretSource } from '../adapters/credentials.ts'
import type { ControlChannel } from '../control/channel.ts'
import { AppError } from './errors.ts'

const log = getLogger(['application', 'secrets'])
const NAME = new RegExp(SECRET_NAME_PATTERN)

export interface SecretServiceOptions {
  source: SecretSource
  store: SessionStore
  /** IPC 模式下接收 secret.store；独立运行时不会收到。 */
  control?: ControlChannel
}

export class SecretService {
  readonly #source: SecretSource
  readonly #store: SessionStore
  readonly #listeners = new Set<(name: string) => void>()
  readonly #unregister: () => void
  /** 工具声明的 Secrets（CokoTool.secrets）同样只解析登记的名字。 */
  readonly provider: SecretProvider

  constructor(options: SecretServiceOptions) {
    this.#source = options.source
    this.#store = options.store
    this.provider = { get: (name) => this.resolve(name) }
    // 已解密的值登记为进程级脱敏来源：Memory、模型错误、工具结果与日志共用（@coko/logging）。
    this.#unregister = registerSecretValues(() => this.#source.cachedValues())
    options.control?.onMessage((message) => {
      if (message.type !== 'secret.store') return
      const reply = (ok: boolean, error?: string) =>
        void options.control!.send({ type: 'secret.store.result', requestId: message.requestId, ok, ...(error ? { error } : {}) })
      this.#storeCiphertext(message.name, Buffer.from(message.ciphertext, 'base64'), message.hint).then(
        () => reply(true),
        (error: unknown) => reply(false, error instanceof Error ? error.message : String(error)),
      )
    })
  }

  get kind(): SecretSource['kind'] {
    return this.#source.kind
  }

  async list(): Promise<SecretsResponse> {
    return { source: this.#source.kind, secrets: await this.#source.list() }
  }

  async delete(name: string): Promise<void> {
    if (!NAME.test(name)) throw new AppError('bad-request', `Invalid secret name: ${name}`)
    if (this.#source.kind === 'environment') throw new AppError('bad-request', 'Secrets come from COKO_SECRET_* variables in this mode and cannot be deleted')
    await this.#store.secrets.delete(name)
    this.#source.invalidate(name)
    log.info('secret deleted', { name })
    this.#changed(name)
  }

  /** 登记名字的明文；未登记时 undefined。 */
  resolve(name: string): Promise<string | undefined> {
    return this.#source.get(name)
  }

  /**
   * 注入接缝（MCP 的 stderr、诊断与错误文本经它脱敏，测试可替换）：按值替换已登记的明文，再按凭据形态脱敏（@coko/logging 的 redactText）。
   */
  redact(text: string): string {
    return redactText(text)
  }

  /** 只按值替换已登记的明文，不应用凭据形态规则（工具结果、提示模板展开等须保持原样的文本）。 */
  redactValues(text: string): string {
    return redactSecretValues(text)
  }

  /** 注销进程级脱敏来源（测试；Sidecar 进程内只有一个实例）。 */
  dispose(): void {
    this.#unregister()
  }

  /** 某个名字被登记、替换或删除之后调用（引用它的 MCP 连接据此关闭）。 */
  onChange(listener: (name: string) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async #storeCiphertext(name: string, ciphertext: Uint8Array, hint: string): Promise<void> {
    if (this.#source.kind !== 'stored') throw new Error('Secrets cannot be stored in this mode')
    if (!NAME.test(name)) throw new Error(`Invalid secret name: ${name}`)
    await this.#store.secrets.setCiphertext(name, { ciphertext, hint })
    this.#source.invalidate(name)
    log.info('secret stored', { name })
    this.#changed(name)
  }

  #changed(name: string): void {
    for (const listener of this.#listeners) listener(name)
  }
}
