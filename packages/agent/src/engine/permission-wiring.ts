// 权限判定在运行时的接线（ADR 0005）：链首的 beforeToolCall（暂停时改写文本）、执行前的复核与沙箱档位、沙箱拒绝的记录。
import { resolveSecrets, type SecretProvider } from '../ports/secrets.ts'
import type { createApprovalBroker } from '../policy/broker.ts'
import { readDenial } from '../policy/decide.ts'
import { createPermissionGate, OPERATION_ABORTED_TEXT, ToolCallBlockedError } from '../policy/gate.ts'
import { realLocation } from '../policy/paths.ts'
import { sandboxModeFor, sandboxPolicyFor, widerSandbox } from '../policy/sandbox.ts'
import type { SandboxMode } from '../session-entries/index.ts'
import type { ToolRegistry } from '../tools/registry.ts'
import type { SchedulingOptions } from '../tools/scheduler.ts'
import type { CokoTool } from '../tools/types.ts'
import type { RuntimePermissions } from './types.ts'

/** 等待审批时被暂停的调用交给模型的文本（未执行）。 */
export const PAUSED_BEFORE_APPROVAL_TEXT = 'Not run: the user paused the run before this call was approved.'

/** 权限接线读写的 Run 状态（运行时的 RunState 的一部分）。 */
export interface PermissionRun {
  rejected: boolean
  paused: boolean
  /** Aborted by pause(): cancels approvals that are waiting (not running tools). */
  pauseSignal: AbortController
  commitError?: Error
}

type Gate = ReturnType<typeof createPermissionGate>

export interface PermissionWiring {
  /** 链首的权限判定；没有权限判定时 undefined。 */
  beforeToolCall: ((context: Parameters<Gate['beforeToolCall']>[0], signal?: AbortSignal) => ReturnType<Gate['beforeToolCall']>) | undefined
  /** 执行前的准备（交给调度）。 */
  prepare: NonNullable<SchedulingOptions['prepare']>
  /** 包装声明了 sandboxRequest 的工具，记录被沙箱拒绝的命令。 */
  observeSandbox(tool: CokoTool): CokoTool
  /** Run 结束：批准后未执行的提权、复核目标与沙箱拒绝记录不延续到下一个 Run。 */
  reset(): void
}

export function createPermissionWiring(options: {
  cwd: string
  permissions: RuntimePermissions | undefined
  secrets: SecretProvider | undefined
  registry: ToolRegistry
  broker: ReturnType<typeof createApprovalBroker>
  current: () => PermissionRun | undefined
  /** 提交失败时停止 agent 循环。 */
  abortAgent: () => void
}): PermissionWiring {
  const { permissions, registry, current } = options
  /** 已批准的单次提权，按 toolCallId；执行时取用并删除，Run 结束时清空。 */
  const escalations = new Map<string, SandboxMode>()
  let workspace: Promise<string> | undefined
  const realWorkspace = () => (workspace ??= realLocation(options.cwd))
  /** 等待中的审批另加上本 Run 的暂停信号。 */
  const pausable = (run: PermissionRun | undefined, signal: AbortSignal | undefined) => {
    const paused = run?.pauseSignal.signal
    return paused ? (signal ? AbortSignal.any([signal, paused]) : paused) : signal
  }

  const gate = permissions
    ? createPermissionGate({
        cwd: options.cwd,
        tool: (name) => registry.get(name),
        permissionClass: (name) => registry.permissionClass(name),
        ...(permissions.readRoots ? { readRoots: permissions.readRoots } : {}),
        broker: options.broker,
        mode: permissions.mode,
        rules: permissions.rules,
        rejected: () => current()?.rejected ?? false,
        reject: () => {
          const run = current()
          if (run) run.rejected = true
        },
        commitFailed: (error) => {
          const run = current()
          if (!run) return
          run.commitError ??= error
          options.abortAgent()
        },
        grantEscalation: (toolCallId, mode) => void escalations.set(toolCallId, mode),
      })
    : undefined

  /** 复核期间暂停：等待中的复核审批与 beforeToolCall 中的一样以"暂停前未批准"结束。 */
  const recheck = async (toolCallId: string, toolName: string, params: unknown, signal: AbortSignal | undefined) => {
    const run = current()
    try {
      await gate!.recheck(toolCallId, toolName, params, pausable(run, signal))
    } catch (error) {
      if (error instanceof ToolCallBlockedError && error.message === OPERATION_ABORTED_TEXT && run?.paused && !signal?.aborted)
        throw new ToolCallBlockedError(PAUSED_BEFORE_APPROVAL_TEXT)
      throw error
    }
  }

  return {
    // 暂停只取消等待中的审批（不中断执行中的工具）。只有被暂停取消的审批改写为"暂停前未批准"；规则拒绝、参数错误与跳过保留原文。
    beforeToolCall: gate
      ? async (context, signal) => {
          const run = current()
          const result = await gate.beforeToolCall(context, pausable(run, signal))
          if (result?.block && result.reason === OPERATION_ABORTED_TEXT && run?.paused && !signal?.aborted)
            return { block: true, reason: PAUSED_BEFORE_APPROVAL_TEXT }
          return result
        }
      : undefined,
    /**
     * 执行前的准备（取得执行槽之后、执行记录之前，ADR 0005）：文件写入的目标按执行时的真实路径复核；沙箱档位按执行时的模式现算，
     * 已批准的提权取两者中较宽者；目录工具拿到 Read 拒绝规则的过滤；声明的密钥只为这一次调用解析，缺失时调用失败且不提交执行记录。
     * 没有权限判定时不设沙箱与过滤（库调用方，命令不受限）。
     */
    async prepare({ toolCallId, tool, params, signal }) {
      const extra: { sandbox?: Awaited<ReturnType<typeof sandboxPolicyFor>>; secrets?: Record<string, string>; readDenied?: (path: string) => boolean } = {}
      if (permissions && gate) {
        await recheck(toolCallId, tool.name, params, signal)
        const granted = escalations.get(toolCallId)
        escalations.delete(toolCallId)
        const mode = sandboxModeFor(permissions.mode())
        const root = await realWorkspace()
        extra.sandbox = await sandboxPolicyFor(granted ? widerSandbox(granted, mode) : mode, root)
        const denied = readDenial(permissions.rules(), root)
        if (denied) extra.readDenied = denied
      }
      const secrets = await resolveSecrets(tool.name, tool.secrets, options.secrets)
      if (secrets) extra.secrets = secrets
      return extra
    },
    /** 记录被沙箱拒绝的命令（结果带 details.sandbox.denied）：之后同一命令才能带提权参数重试。 */
    observeSandbox: (tool) =>
      !gate || !tool.sandboxRequest
        ? tool
        : {
            ...tool,
            async execute(toolCallId, params, signal, onUpdate, context) {
              const result = await tool.execute(toolCallId, params, signal, onUpdate, context)
              const details = result.details as { sandbox?: { denied?: boolean } } | undefined
              const command = tool.permissionSubject?.(params)
              if (details?.sandbox?.denied && command !== undefined) gate.recordSandboxDenial(command)
              return result
            },
          },
    reset() {
      escalations.clear()
      gate?.reset()
    },
  }
}
