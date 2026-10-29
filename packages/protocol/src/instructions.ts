// 指令文件（AGENTS.md / CLAUDE.md）：已加载文件的 DTO（供上下文用量接口）；诊断用 config.ts 的 ResourceDiagnostic。
import { Type, type Static } from 'typebox'

const strict = { additionalProperties: false } as const

/** 一个已加载的指令文件：user（COKO_HOME）、project（仓库根到 Workspace）或 nested（触及子目录时加载）。 */
export const LoadedInstructionFile = Type.Object(
  {
    path: Type.String(),
    scope: Type.Union([Type.Literal('user'), Type.Literal('project'), Type.Literal('nested')]),
    /** 注入的字符数（截断后）。 */
    chars: Type.Integer({ minimum: 0 }),
    /** 超过单文件或合计预算被截断。 */
    truncated: Type.Boolean(),
  },
  strict,
)
export type LoadedInstructionFile = Static<typeof LoadedInstructionFile>
