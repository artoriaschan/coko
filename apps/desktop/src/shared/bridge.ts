// main、preload 与 renderer 共用的受控 IPC 契约。renderer 只导入类型。
import type { ErrorCode, Provider, ProviderFields, ProviderSaveMode } from '@coko/protocol'

export const IPC = {
  boot: 'coko:boot',
  pickDirectory: 'coko:pick-directory',
  saveProvider: 'coko:save-provider',
  setSecret: 'coko:set-secret',
  log: 'coko:log',
  openLogs: 'coko:open-logs',
  /** main → renderer：boot 之后 Sidecar 的状态变化（重启、重启完成、终态失败）。 */
  sidecarState: 'coko:sidecar-state',
} as const

/** boot 信息：不含启动令牌或 cookie。 */
export interface BootInfo {
  /** WebSocket 基址，例如 ws://127.0.0.1:51234 */
  readonly wsBaseUrl: string
  readonly platform: NodeJS.Platform
  readonly locale: string
}

export interface BootFailure {
  readonly code: string
  readonly message: string
}

export type BootResult = { readonly ok: true; readonly info: BootInfo } | { readonly ok: false; readonly error: BootFailure }

/**
 * boot 之后的 Sidecar 状态：restarting 时 renderer 暂停连接；ready 带新的 WebSocket 基址（cookie 已重新交换），
 * renderer 重连并补齐；failed 为终态（连续重启失败），renderer 停止重连。
 */
export type SidecarStateEvent =
  | { readonly phase: 'restarting'; readonly attempt: number }
  | { readonly phase: 'ready'; readonly wsBaseUrl: string }
  | { readonly phase: 'failed'; readonly error: BootFailure }

/**
 * main 一侧保存密钥类值的失败原因：invalid-input（输入不合要求）、encryption-unavailable（safeStorage 不可用，不回退明文）、
 * sidecar-unavailable（Sidecar 未就绪或已断开）、rejected（Sidecar 拒绝保存）、timeout。
 */
export type CredentialErrorCode = 'invalid-input' | 'encryption-unavailable' | 'sidecar-unavailable' | 'rejected' | 'timeout'

/**
 * 一次提交的 Provider 草稿（ADR 0010）：完整配置与可选的新 Key。新建必须带 Key；编辑不带 Key 表示保留原 Credential。
 * 不能通过空值删除已有 Key。
 */
export interface SaveProviderInput {
  readonly mode: ProviderSaveMode
  readonly provider: ProviderFields
  readonly secret?: string
}

/**
 * 一次提交的失败原因：main 一侧的 invalid-input（草稿或 Key 不合要求）、encryption-unavailable、sidecar-unavailable、timeout，
 * 以及 Sidecar 回答的协议错误码（already-exists、bad-request、not-found 等，details 原样带回）。任何失败都表示配置与 Key 都未写入。
 */
export type ProviderSaveErrorCode = Exclude<CredentialErrorCode, 'rejected'> | ErrorCode

/** 成功时回传保存后的 Provider（只含是否已配置与末四位）；密钥不返回 renderer。 */
export type SaveProviderResult =
  | { readonly ok: true; readonly provider: Provider }
  | { readonly ok: false; readonly code: ProviderSaveErrorCode; readonly message: string; readonly details?: Readonly<Record<string, unknown>> }

/** 登记 Secret 的失败原因（invalid-input 为名字或值不合要求）。 */
export type SecretErrorCode = CredentialErrorCode

/** 成功时只回传末四位提示；值不返回 renderer（ADR 0007）。 */
export type SetSecretResult = { readonly ok: true; readonly hint: string } | { readonly ok: false; readonly code: SecretErrorCode; readonly message: string }

/** renderer 转发给 main 的一条日志；main 校验级别、字段与大小（上限 16 KiB）并标记来源。 */
export interface RendererLogInput {
  readonly level: 'trace' | 'debug' | 'info' | 'warning' | 'error' | 'fatal'
  readonly message: string
  /** 追加在 coko.renderer 之后的分类，最多 4 段。 */
  readonly category?: readonly string[]
  readonly properties?: Readonly<Record<string, unknown>>
}

/** preload 经 contextBridge 暴露为 window.coko。 */
export interface CokoBridge {
  /** 等待 sidecar 就绪并完成令牌交换。 */
  boot(): Promise<BootResult>
  /** 打开目录选择对话框；取消时为 null。 */
  pickDirectory(): Promise<string | null>
  /**
   * 一次提交 Provider（ADR 0010）：main 用 safeStorage 加密 Key 后，配置与密文经一条控制消息交给 Sidecar，在一个事务中写入；
   * 加密不可用时整次拒绝、不发送任何消息。Key 不经 HTTP，也不返回 renderer（ADR 0004）。
   */
  saveProvider(input: SaveProviderInput): Promise<SaveProviderResult>
  /** 登记或替换一个 Secret：main 用 safeStorage 加密，密文经控制 IPC secret.store 存入 Sidecar（ADR 0007）；值不经 HTTP。 */
  setSecret(name: string, value: string): Promise<SetSecretResult>
  /** 把一条日志转发到 main 的 desktop.jsonl；不等待、不回报结果。 */
  log(record: RendererLogInput): void
  /** 在系统文件管理器中打开日志文件夹（诊断入口）；返回是否成功。 */
  openLogs(): Promise<boolean>
  /** 订阅 boot 之后的 Sidecar 状态变化；返回取消订阅函数。 */
  onSidecarState(listener: (event: SidecarStateEvent) => void): () => void
}

// 声明放在契约旁：renderer 与 E2E（经 page.evaluate 访问 window.coko）分属不同 tsconfig 项目，都导入本文件。
declare global {
  interface Window {
    /** preload 暴露的受控 API；只在 coko-app://app 主窗口中存在。 */
    readonly coko?: CokoBridge
  }
}
