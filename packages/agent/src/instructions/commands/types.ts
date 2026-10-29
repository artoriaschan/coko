// 命令目录的条目形状（ADR 0009：用户编写的资源为文件）。来源即 command 条目 payload 的 source（session-entries/context.ts）。
import type { CommandSource } from '../../session-entries/context.ts'

/** 同名时按此顺序取一个（内置 > 项目 > 用户 > Skill > MCP 提示模板）。 */
export const COMMAND_SOURCE_ORDER: readonly CommandSource[] = ['builtin', 'project', 'user', 'skill', 'mcp']

/** 命令目录中的一条：名字不含开头的 `/`，命名空间以 `:` 连接。 */
export interface CommandDefinition {
  name: string
  description: string
  argumentHint?: string | undefined
  source: CommandSource
  /** 定义它的文件（模板与 Skill）；内置与 MCP 提示模板省略。 */
  path?: string | undefined
  /** 来源自己的停用（例如 skills.disabled）；省略为启用。 */
  enabled?: boolean | undefined
}

/** COKO_HOME/commands 或 <Workspace>/.coko/commands 下的提示模板。 */
export interface CommandTemplate extends CommandDefinition {
  source: 'project' | 'user'
  path: string
  /** 去掉 frontmatter 的正文（未展开参数）。 */
  content: string
}

/** 内置命令：展开为一个动作（由宿主的 actions[action] 执行），不是提示模板。 */
export interface BuiltinCommand {
  name: string
  description: string
  argumentHint?: string
  action: string
}
