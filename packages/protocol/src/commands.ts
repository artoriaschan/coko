// 命令目录（GET /api/commands）。命令条目的 payload 见 context-entries.ts（CommandPayload）。
import { Type, type Static } from 'typebox'
import { ResourceDiagnostic } from './config.ts'
import { CommandSource } from './context-entries.ts'

const strict = { additionalProperties: false } as const

/** 命令目录的一条：每个名字一条（同名按 内置 > 项目 > 用户 > Skill > MCP 取一个，被遮蔽的只出现在诊断中）。 */
export const CommandInfo = Type.Object(
  {
    /** 不含开头的 `/`；子目录以 `:` 拼名。 */
    name: Type.String({ minLength: 1 }),
    description: Type.String(),
    argumentHint: Type.Optional(Type.String()),
    source: CommandSource,
    /** 定义它的文件（模板与 Skill）。 */
    path: Type.Optional(Type.String()),
    /** 停用的命令（commands.enabled / commands.disabled，或来源自己的停用）不展开，提交时原样作为普通消息。 */
    enabled: Type.Boolean(),
  },
  strict,
)
export type CommandInfo = Static<typeof CommandInfo>

/** GET /api/commands?sessionId=… | workspaceId=…：该 Workspace 的命令目录（按来源顺序、再按名字）与加载诊断。 */
export const CommandListResponse = Type.Object({ commands: Type.Array(CommandInfo), diagnostics: Type.Array(ResourceDiagnostic) }, strict)
export type CommandListResponse = Static<typeof CommandListResponse>

export const commandPaths = {
  /** GET：命令目录；查询参数 sessionId 或 workspaceId（二选一，都缺时 400，不存在时 404）。 */
  commands: '/api/commands',
} as const

/** 项目级与用户级命令目录（相对 Workspace 与 COKO_HOME）。 */
export const PROJECT_COMMANDS_DIR = '.coko/commands'
export const USER_COMMANDS_DIR = 'commands'
