import { Type, type Static } from 'typebox'

// Sidecar 与 Electron main 之间经 Node IPC（结构化克隆）传递的控制消息：生命周期、inspect-quit 与 credential.*。

const strict = { additionalProperties: false } as const
const RequestId = Type.Integer({ minimum: 1 })

/** 32 字节随机启动令牌的 base64url 编码（无填充，43 个字符）。 */
export const LaunchToken = Type.String({ pattern: '^[A-Za-z0-9_-]{43}$' })

export const SidecarStarting = Type.Object({ type: Type.Literal('starting') }, strict)
export const SidecarReady = Type.Object({ type: Type.Literal('ready'), port: Type.Integer({ minimum: 1, maximum: 65535 }), token: LaunchToken }, strict)
export const SidecarFatal = Type.Object({ type: Type.Literal('fatal'), code: Type.String({ minLength: 1 }), message: Type.String() }, strict)
export const SidecarShutdownComplete = Type.Object({ type: Type.Literal('shutdown-complete') }, strict)
/** 对 inspect-quit 的回答：当前未结束的 Run 数量。 */
export const SidecarInspectQuitResult = Type.Object(
  { type: Type.Literal('inspect-quit.result'), requestId: RequestId, activeRuns: Type.Integer({ minimum: 0 }) },
  strict,
)

// ---- Credential（ADR 0004）----
// Node IPC 默认按 JSON 序列化，二进制密文以标准 base64 传输。

/** safeStorage 密文的 base64 编码。 */
export const CredentialCiphertext = Type.String({ minLength: 1, pattern: '^[A-Za-z0-9+/]+={0,2}$' })

/** sidecar 需要某个 Provider 的明文时，请 main 用 safeStorage 解密库中的密文。 */
export const SidecarCredentialDecrypt = Type.Object(
  { type: Type.Literal('credential.decrypt'), requestId: RequestId, ciphertext: CredentialCiphertext },
  strict,
)
/** 对 credential.store 的确认；ok 为 false 时密文未保存。 */
export const SidecarCredentialStoreResult = Type.Object(
  { type: Type.Literal('credential.store.result'), requestId: RequestId, ok: Type.Boolean(), error: Type.Optional(Type.String()) },
  strict,
)

export const SidecarToMainMessage = Type.Union([
  SidecarStarting,
  SidecarReady,
  SidecarFatal,
  SidecarShutdownComplete,
  SidecarInspectQuitResult,
  SidecarCredentialDecrypt,
  SidecarCredentialStoreResult,
])
export type SidecarToMainMessage = Static<typeof SidecarToMainMessage>

export const MainShutdown = Type.Object({ type: Type.Literal('shutdown') }, strict)
export const MainInspectQuit = Type.Object({ type: Type.Literal('inspect-quit'), requestId: RequestId }, strict)

/** main 加密 renderer 输入的密钥后，把密文与末四位提示交给 sidecar 存库；明文不经过 sidecar。 */
export const MainCredentialStore = Type.Object(
  {
    type: Type.Literal('credential.store'),
    requestId: RequestId,
    providerId: Type.String({ minLength: 1 }),
    ciphertext: CredentialCiphertext,
    hint: Type.String({ maxLength: 4 }),
  },
  strict,
)
/** 对 credential.decrypt 的回答：成功给出 plaintext，失败给出 error。 */
export const MainCredentialDecryptResult = Type.Union([
  Type.Object({ type: Type.Literal('credential.decrypt.result'), requestId: RequestId, plaintext: Type.String({ minLength: 1 }) }, strict),
  Type.Object({ type: Type.Literal('credential.decrypt.result'), requestId: RequestId, error: Type.String() }, strict),
])

export const MainToSidecarMessage = Type.Union([MainShutdown, MainInspectQuit, MainCredentialStore, MainCredentialDecryptResult])
export type MainToSidecarMessage = Static<typeof MainToSidecarMessage>
