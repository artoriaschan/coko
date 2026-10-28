import { Type, type Static } from 'typebox'

// Sidecar 与 Electron main 之间经 Node IPC（结构化克隆）传递的控制消息。
// 只包含 M1 已接入的消息；credential.* 由凭据切片补充。

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

export const SidecarToMainMessage = Type.Union([SidecarStarting, SidecarReady, SidecarFatal, SidecarShutdownComplete, SidecarInspectQuitResult])
export type SidecarToMainMessage = Static<typeof SidecarToMainMessage>

export const MainShutdown = Type.Object({ type: Type.Literal('shutdown') }, strict)
export const MainInspectQuit = Type.Object({ type: Type.Literal('inspect-quit'), requestId: RequestId }, strict)

export const MainToSidecarMessage = Type.Union([MainShutdown, MainInspectQuit])
export type MainToSidecarMessage = Static<typeof MainToSidecarMessage>
