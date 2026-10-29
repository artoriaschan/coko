// 登记的 Secret（ADR 0007）：GET /api/secrets、DELETE /api/secrets/:name。值只经 preload setSecret → main safeStorage →
// 控制 IPC secret.store 进入 Sidecar（见 control.ts），HTTP 从不携带值。
import { Type, type Static } from 'typebox'

const strict = { additionalProperties: false } as const

/** Secret 名：大写字母开头，大写字母、数字与下划线，至多 64 个字符。 */
export const SECRET_NAME_PATTERN = '^[A-Z][A-Z0-9_]{0,63}$'
export const SecretName = Type.String({ pattern: SECRET_NAME_PATTERN })

/** 只有名字与末四位提示（短于 8 个字符的值不给提示）。 */
export const SecretInfo = Type.Object({ name: SecretName, hint: Type.String({ maxLength: 4 }), updatedAt: Type.Optional(Type.Integer()) }, strict)
export type SecretInfo = Static<typeof SecretInfo>

/**
 * GET /api/secrets。source：stored（桌面应用登记、safeStorage 加密）或 environment（无界面运行，只读 COKO_SECRET_<NAME>，
 * 不能经接口删除或登记）。
 */
export const SecretsResponse = Type.Object(
  { source: Type.Union([Type.Literal('stored'), Type.Literal('environment')]), secrets: Type.Array(SecretInfo) },
  strict,
)
export type SecretsResponse = Static<typeof SecretsResponse>

export const secretPaths = {
  secrets: '/api/secrets',
  /** DELETE：不存在时 404；无界面运行时 400。 */
  secret: (name: string) => `/api/secrets/${encodeURIComponent(name)}`,
} as const
