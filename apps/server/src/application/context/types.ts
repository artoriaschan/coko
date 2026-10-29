// 上下文装配（M3 规格"apps/server"）：每个领域一个文件导出 ContextContribution，context/index.ts 按固定顺序组合。
import type { CapabilityConfig, CokoTool, PermissionClass, PermissionRule, RunInput, SystemSection, ToolHooks } from '@coko/agent'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { LoadedInstructionFile, ResourceDiagnostic } from '@coko/protocol'
import type { SessionStore } from '@coko/session'

/** 一次取值的作用域：Workspace（及其 Session，如果有）与当时的有效配置。 */
export interface ContextScope {
  workspaceId: string
  /** Workspace 目录。 */
  cwd: string
  /** 草稿（还没有 Session）时省略。 */
  sessionId?: string
  config: CapabilityConfig
  /** 用户级资源目录（COKO_HOME）。 */
  cokoHome: string
  /** 当时生效的权限规则（Session、全局、Workspace 与 project；票 06 的 File Reference 据此应用 Read 拒绝规则）。省略时没有规则。 */
  permissionRules?(): Promise<PermissionRule[]>
}

/** 宿主贡献的工具及其权限类（工具自身不能声明，见 RegisterToolOptions.permissionClass）。 */
export interface ContributedTool {
  tool: CokoTool
  permissionClass?: PermissionClass
}

/** 输入展开的结果：交给运行时的 RunInput，或一个动作（例如 /compact），由 actions[name] 执行。 */
export type ExpandResult = { kind: 'input'; input: RunInput } | { kind: 'action'; name: string; args: string }

/** 命令目录的一个来源（Skill 与 MCP 提示模板向命令目录登记）；条目形状由票 04 定义。 */
export interface CommandSourceContribution {
  source: 'skill' | 'mcp'
  list(scope: ContextScope): Promise<unknown[]>
}

/** 动作的执行：返回新 Run 的 runId（例如 /compact 的 Run）。 */
export type ContextAction = (input: { scope: ContextScope; sessionId: string; args: string }) => Promise<{ runId: string }>

/** 上下文用量接口的分项（票 10 读取；形状在协议 instructions.ts / config.ts 中声明）。 */
export interface ContextReport {
  /** 分项字符数，键为分项名（例如 instructions、skills、memory）。 */
  breakdown?: Record<string, number>
  instructions?: LoadedInstructionFile[]
  diagnostics?: ResourceDiagnostic[]
}

/** 一个领域对上下文的贡献；全部可选，票 01 的各领域文件都是空贡献。 */
export interface ContextContribution {
  /** 领域名（日志与组合顺序）。 */
  name: string
  systemSections?(scope: ContextScope): Promise<SystemSection[]>
  tools?(scope: ContextScope): Promise<ContributedTool[]>
  /** 额外读取根（例如 Skill 目录），其下的 read 组调用与 Workspace 内读取同样处理。 */
  readRoots?(scope: ContextScope): Promise<string[]>
  hooks?(scope: ContextScope): ToolHooks[]
  /** 返回 undefined 表示不处理，交给下一个领域；前一个领域的结果作为 input 传入。 */
  expandInput?(input: RunInput, scope: ContextScope): Promise<ExpandResult | undefined>
  /** 只改模型请求，不改条目；scope 为该 Run 开始时取值的作用域（含有效配置）。 */
  transformMessages?(messages: AgentMessage[], scope: ContextScope): AgentMessage[]
  commandSources?: CommandSourceContribution[]
  actions?: Record<string, ContextAction>
  report?(scope: ContextScope): Promise<ContextReport>
  /** 有序关闭时调用（存储关闭之前）。 */
  close?(): Promise<void>
}

export interface ContextContributionOptions {
  cokoHome: string
  /** MCP 连接池（票 07）；省略时 mcp 贡献为空。 */
  mcp?: import('./mcp.ts').McpManager
  /** Memory 的存储（票 09）；缺省时 Memory 为空贡献。 */
  memories?: MemoryStore
}

/** Memory 贡献需要的存储部分：记忆仓库与 Workspace 查询。 */
export type MemoryStore = { memories: SessionStore['memories']; sessions: Pick<SessionStore['sessions'], 'getWorkspace'> }
