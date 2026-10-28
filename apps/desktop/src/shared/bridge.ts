// main、preload 与 renderer 共用的受控 IPC 契约。renderer 只导入类型。

export const IPC = {
  boot: 'coko:boot',
  pickDirectory: 'coko:pick-directory',
  setCredential: 'coko:set-credential',
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
 * 设置 Credential 的失败原因：invalid-input（Provider id 或密钥不合要求）、encryption-unavailable（safeStorage 不可用，
 * 不回退明文）、sidecar-unavailable（Sidecar 未就绪或已断开）、rejected（Sidecar 拒绝保存，如 Provider 不存在）、timeout。
 */
export type CredentialErrorCode = 'invalid-input' | 'encryption-unavailable' | 'sidecar-unavailable' | 'rejected' | 'timeout'

/** 成功时只回传末四位提示；密钥不返回 renderer。 */
export type SetCredentialResult =
  | { readonly ok: true; readonly hint: string }
  | { readonly ok: false; readonly code: CredentialErrorCode; readonly message: string }

/** preload 经 contextBridge 暴露为 window.coko。 */
export interface CokoBridge {
  /** 等待 sidecar 就绪并完成令牌交换。 */
  boot(): Promise<BootResult>
  /** 打开目录选择对话框；取消时为 null。 */
  pickDirectory(): Promise<string | null>
  /** 把密钥交给 main 用 safeStorage 加密，密文经控制 IPC 存入 Sidecar（ADR 0004）；明文不经 HTTP。 */
  setCredential(providerId: string, secret: string): Promise<SetCredentialResult>
}

// 声明放在契约旁：renderer 与 E2E（经 page.evaluate 访问 window.coko）分属不同 tsconfig 项目，都导入本文件。
declare global {
  interface Window {
    /** preload 暴露的受控 API；只在 coko-app://app 主窗口中存在。 */
    readonly coko?: CokoBridge
  }
}
