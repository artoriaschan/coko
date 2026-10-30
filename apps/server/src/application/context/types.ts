// 上下文装配（docs/subsystems/context.md）：每个领域一个文件导出 ContextContribution，context/index.ts 按固定顺序组合。
// M4 起另有请求前检查（beforeRequest）、下一个 Run 的待送达内容（pendingInput）与 Run 结束通知（onRunEnd）。
import type {
  BeforeRequestState,
  CapabilityConfig,
  CokoTool,
  CommandDefinition,
  CompactInfo,
  CompactVerdict,
  PermissionClass,
  PermissionHookPort,
  PermissionRule,
  RunError,
  RunEntry,
  RunInput,
  RunResult,
  StandardPermissionMode,
  StopContinue,
  StopInfo,
  SystemSection,
  ToolHooks,
} from '@coko/agent'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { TextContent } from '@earendil-works/pi-ai'
import type { LoadedInstructionFile, ResourceDiagnostic } from '@coko/protocol'
import type { SessionEntry, SessionStore } from '@coko/session'

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
  /** 当时生效的权限规则（Session、全局、Workspace 与 project；File Reference 与指令文件据此应用 Read 拒绝规则）。省略时没有规则。 */
  permissionRules?(): Promise<PermissionRule[]>
  /** 子 Session（子代理，ADR 0014）的父 Session。 */
  parentSessionId?: string
  /** 子 Session 所用的子代理定义（工具、模式上限与轮次上限）。 */
  subagent?: { name: string; tools: readonly string[]; permissionMode?: StandardPermissionMode; maxTurns: number }
  /** Session 创建时绑定的 worktree（ADR 0016）；cwd 为其中的工作目录。 */
  worktreeId?: string
}

/** beforeSubmit 的结果：reject 拒绝提交（HTTP 400 hook-blocked，不提交 user message）；context 作为 user message 中单独的文本块。 */
export type SubmitVerdict = void | { reject: string } | { context: string }

/** 宿主贡献的工具及其权限类（工具自身不能声明，见 RegisterToolOptions.permissionClass）。 */
export interface ContributedTool {
  tool: CokoTool
  permissionClass?: PermissionClass
}

/**
 * 贡献工具在规则中的名字来源（静态、与 Run 无关）：写规则时即使当前没有注册（领域关闭、Server 未连接）也接受这些名字，
 * 并按权限类归一（例如 memory-write → Memory）。
 */
export interface RuleTool {
  name: string
  permissionClass: PermissionClass
}

/** 输入展开的结果：交给运行时的 RunInput，或一个动作（例如 /compact），由 actions[name] 执行。 */
export type ExpandResult = { kind: 'input'; input: RunInput } | { kind: 'action'; name: string; args: string }

/**
 * Skill 与 MCP 提示模板向命令目录登记的一条（CommandSourceContribution.list 的元素）。被调用时由来源展开：返回展开后的文本；
 * 参数不合要求时抛出 AppError（例如缺少必填参数时 bad-request），提交以该错误失败。
 */
export interface SourcedCommand extends CommandDefinition {
  source: 'skill' | 'mcp'
  expand(args: string, scope: ContextScope): Promise<string>
}

/** 命令目录的一个来源（Skill 与 MCP 提示模板向命令目录登记）。 */
export interface CommandSourceContribution {
  source: 'skill' | 'mcp'
  list(scope: ContextScope): Promise<SourcedCommand[]>
}

/**
 * 开始 Run 的统一请求（session-runs.ts 的 startRun）：submit、Goal Round、重试、继续与手动压缩都经它，检查相同。
 * submit 与 goal 的 user message 开头合并各领域的 pendingInput。
 */
export type RunRequest =
  | { trigger: 'submit'; input: RunInput }
  | { trigger: 'goal'; input: RunInput; goal: { goalId: string; round: number } }
  | { trigger: 'retry' }
  | { trigger: 'continue' }
  | { trigger: 'compact'; instructions?: string }
  /** 定时任务到期（ADR 0015）：输入不经命令展开，pendingInput 照常合并在前。 */
  | { trigger: 'schedule'; input: RunInput; schedule: { scheduleId: string; occurrence: number } }
  /** 子 Session 的 Run（ADR 0014）。 */
  | { trigger: 'subagent'; input: RunInput }
  /** 交接的摘要 Run：只发一次请求、没有工具（运行时的摘要模式），input 为摘要提示。 */
  | { trigger: 'handoff'; input: RunInput }

/** 动作执行时 SessionService 提供的能力：该 Session 的已提交条目，与开始一个 Run（与 submit 相同的检查）。 */
export interface ContextActionSession {
  entries(): Promise<readonly SessionEntry[]>
  start(request: RunRequest): Promise<{ runId: string }>
  /** 把文本作为普通提交（例如 /plan 消息：切换模式后随后提交消息）。 */
  submit(text: string): Promise<{ runId: string }>
  /** 此刻是否有 Run 在进行。 */
  running(): boolean
}

/** 动作的结果：开始的 Run（HTTP 202 { runId }），或不开始 Run 的动作已完成（HTTP 204，例如 /goal pause）。 */
export type ActionResult = { runId: string } | { done: true }

export interface ContextActionInput {
  scope: ContextScope
  sessionId: string
  args: string
  session: ContextActionSession
}

/**
 * 动作的执行。whileRunning：Run 进行中也可执行（例如 /goal pause、/goal cancel），按参数判断；Run 进行中提交时只查内置命令表
 * （不展开输入、不读命令目录），只有 whileRunning(args) 为 true 的动作才执行，其余以 run-in-progress 拒绝。
 */
export type ContextAction = ((input: ContextActionInput) => Promise<ActionResult>) & { whileRunning?: (args: string) => boolean }

/** 合并到下一个 Run 的 user message 开头的内容（例如后台任务的完成通知）。 */
export interface PendingInput {
  content: TextContent[]
  /** 紧接在该 user message 之前提交的条目（例如 job_notification）。 */
  before?: RunEntry[]
  /** Run 已开始、这些内容已交给运行时之后调用；Run 没能开始时不调用，内容留到下一次。 */
  delivered(): void
}

/** 每次模型请求前的检查（预算）；返回 stop 时不发出该请求，Run 以 paused 加该 error 结束。 */
export type RequestVerdict = void | { stop: RunError }

/** Run 结束（run_end 已提交或提交失败）之后交给各领域的事实。 */
export interface RunEndInfo {
  sessionId: string
  runId: string
  trigger: RunRequest['trigger']
  goal?: { goalId: string; round: number }
  schedule?: { scheduleId: string; occurrence: number }
  result: RunResult
}

/** 上下文用量接口的分项（上下文用量接口读取；形状在协议 instructions.ts / config.ts 中声明）。 */
export interface ContextReport {
  /** 分项字符数，键为分项名（例如 instructions、skills、memory）。 */
  breakdown?: Record<string, number>
  instructions?: LoadedInstructionFile[]
  diagnostics?: ResourceDiagnostic[]
}

/** 一个领域对上下文的贡献；全部可选，没有的钩子不参与组合。 */
export interface ContextContribution {
  /** 领域名（日志与组合顺序）。 */
  name: string
  systemSections?(scope: ContextScope): Promise<SystemSection[]>
  tools?(scope: ContextScope): Promise<ContributedTool[]>
  /** 本领域可能贡献的工具及其权限类（PermissionService 据此校验与归一规则中的工具名）。 */
  ruleTools?: readonly RuleTool[]
  /** 额外读取根（例如 Skill 目录），其下的 read 组调用与 Workspace 内读取同样处理。 */
  readRoots?(scope: ContextScope): Promise<string[]>
  hooks?(scope: ContextScope): ToolHooks[]
  /**
   * 准入 hook：只决定调用是否执行（返回 block 或 undefined），没有副作用；排在权限判定之后、扩展（checkpoint 备份）与 hooks 之前，
   * 被拦下的调用不经过任何有副作用的 hook（例如预算拦截）。
   */
  admissionHooks?(scope: ContextScope): ToolHooks[]
  /** 返回 undefined 表示不处理，交给下一个领域；前一个领域的结果作为 input 传入。 */
  expandInput?(input: RunInput, scope: ContextScope): Promise<ExpandResult | undefined>
  /** 只改模型请求，不改条目；scope 为该 Run 开始时取值的作用域（含有效配置）。 */
  transformMessages?(messages: AgentMessage[], scope: ContextScope): AgentMessage[]
  commandSources?: CommandSourceContribution[]
  actions?: Record<string, ContextAction>
  report?(scope: ContextScope): Promise<ContextReport>
  /** 每次模型请求前（自动压缩之后）；第一个返回 stop 的领域为准。scope 为该 Run 开始时的作用域。 */
  beforeRequest?(state: BeforeRequestState, scope: ContextScope): Promise<RequestVerdict>
  /** submit 与 Goal Round 的 Run 开始时取一次：合并到 user message 开头的内容；没有时 undefined。 */
  pendingInput?(scope: ContextScope): Promise<PendingInput | undefined>
  /** Run 结束之后（run_end 已提交或提交失败）；Goal 推进与 waiting-input 判定用。 */
  onRunEnd?(scope: ContextScope, info: RunEndInfo): Promise<void>
  /** M5：外部 Hook 在权限判定中的端口（PreToolUse / PermissionRequest）；至多一个领域给出（Hook）。 */
  permissionHooks?(scope: ContextScope): PermissionHookPort | undefined
  /** 观察 hook：排在登记明文替换（secretRedactionHook）之后，收到已脱敏的结果（PostToolUse）。 */
  observeHooks?(scope: ContextScope): ToolHooks[]
  /** trigger submit 的输入展开之后、开始 Run 之前；第一个 reject 为准，各领域的 context 依次合并。 */
  beforeSubmit?(scope: ContextScope, text: string): Promise<SubmitVerdict>
  /** 手动与自动压缩之前（运行时的 beforeCompact）；第一个 block 为准，instructions 依次合并。 */
  beforeCompact?(scope: ContextScope, info: CompactInfo): Promise<void | CompactVerdict>
  /** 对话 Run 正常结束之前（运行时的 onStop，每 Run 至多继续 3 次）；第一个 continue 为准。 */
  onStop?(scope: ContextScope, info: StopInfo): Promise<void | StopContinue>
  /** 每个 Run 开始时过滤可用工具（名字列表，基础工具与贡献的工具；子代理的工具交集）；按领域顺序依次过滤。 */
  filterTools?(tools: readonly string[], scope: ContextScope): readonly string[]
  /** 有序关闭时调用（存储关闭之前）。 */
  close?(): Promise<void>
}

export interface ContextContributionOptions {
  cokoHome: string
  /** MCP 连接池；省略时 mcp 贡献为空。 */
  mcp?: import('./mcp.ts').McpManager
  /** Memory 的存储；缺省时 Memory 为空贡献。 */
  memories?: MemoryStore
  /** 后台任务（application/jobs.ts）；省略时 jobs 贡献为空。 */
  jobs?: import('../jobs.ts').JobService
  /** Goal（application/goals.ts）；省略时 goal 贡献为空。 */
  goals?: import('../goals.ts').GoalService
  /** 定时任务（application/schedules.ts）；省略时 schedules 贡献只有规则工具名。 */
  schedules?: import('../schedules.ts').ScheduleService
  /** Session 条目的读取与提交（领域自己的条目，例如 todo_list）；省略时这些领域为空贡献。 */
  entries?: SessionEntryAccess
  /** 外部 Hook（application/hooks.ts）；省略时 hooks 贡献为空。 */
  hooks?: import('../hooks.ts').HookService
  /** 交接（application/handoff.ts）；省略时 /handoff 为 400。 */
  handoff?: import('../handoff.ts').HandoffService
  /** 仅测试：额外的贡献，排在全部领域之后（集成测试驱动 seam）。 */
  extra?: readonly ContextContribution[]
}

/**
 * 领域提交自己的条目（例如 todo_write 的 todo_list）：payload 与运行时条目一样经 toNewEntry 替换登记明文后入库，再经 hub 推送。
 * commit 返回实际入库的条目（脱敏之后）。
 */
export interface SessionEntryAccess {
  list(sessionId: string): Promise<readonly SessionEntry[]>
  commit(sessionId: string, entry: RunEntry): Promise<SessionEntry>
}

/** Memory 贡献需要的存储部分：记忆仓库与 Workspace 查询。 */
export type MemoryStore = { memories: SessionStore['memories']; sessions: Pick<SessionStore['sessions'], 'getWorkspace'> }
