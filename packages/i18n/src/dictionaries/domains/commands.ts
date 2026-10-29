// 命令目录与 / 菜单、时间线的命令 chip（票 04）。
import { defineDomain } from './define.ts'

export const commands = defineDomain(
  {
    menuLabel: '命令',
    source: { builtin: '内置', project: '项目', user: '用户', skill: 'Skill', mcp: 'MCP' },
    chipLabel: '命令 {name}',
    showExpanded: '展开后的提示',
  },
  {
    menuLabel: 'Commands',
    source: { builtin: 'Built-in', project: 'Project', user: 'User', skill: 'Skill', mcp: 'MCP' },
    chipLabel: 'Command {name}',
    showExpanded: 'Expanded prompt',
  },
)
