// 加载用户编写的资源（指令、Skills、命令、MCP 配置、能力配置）时的诊断：读取失败或格式错误只产生诊断，不阻止 Run（docs/subsystems/instructions.md）。

export type DiagnosticSource = 'instructions' | 'skills' | 'commands' | 'mcp' | 'config' | 'memory' | 'agents'

export interface ResourceDiagnostic {
  source: DiagnosticSource
  /** 出问题的文件（绝对路径）；与文件无关时省略。 */
  path?: string
  /** 稳定的机器可读代码，例如 read-failed、invalid-frontmatter、unknown-key。 */
  code: string
  /** 给用户看的说明（英文；界面可按 code 本地化）。 */
  message: string
}

export const diagnostic = (source: DiagnosticSource, code: string, message: string, path?: string): ResourceDiagnostic => ({
  source,
  code,
  message,
  ...(path === undefined ? {} : { path }),
})
