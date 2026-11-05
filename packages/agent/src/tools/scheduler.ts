// 工具调度：并发上限与 effect 分区，包住 execute（pi 的 beforeToolCall 仍按调用顺序串行，审批逐个出现）。
// read 调用共享执行槽；side-effect 调用是独占屏障：等前面的调用全部完成才开始，后面的调用等它完成。
// 取得执行槽后先做执行前的准备（复核与执行上下文），再由 side-effect 调用提交 tool_exec 执行记录；任一步失败则不执行。
import { idempotencyKeyFor, type ToolExecPayload } from '../session-entries/tools.ts'
import { storeToolOutput, toolOutputFile } from './output.ts'
import type { CokoTool, ToolEffect, ToolExecutionContext } from './types.ts'

export const DEFAULT_TOOL_CONCURRENCY = 10
/** 排队中被取消的调用的错误文本，与 pi 对未开始调用的文本一致。 */
export const OPERATION_ABORTED = 'Operation aborted'

export interface ToolScheduler {
  /**
   * 按提交顺序（FIFO）排队，取得执行槽后运行 `task`，task 结束后释放。`read` 在没有独占调用运行或排在前面时
   * 共享执行槽（至多 limit 个）；`side-effect` 只在没有任何调用运行时开始，且排在它后面的调用不越过它。
   * 排队中 `signal` 触发：不运行 task，以 Operation aborted 拒绝；已开始的 task 由它自己响应 signal。
   */
  run<T>(effect: ToolEffect, task: () => Promise<T>, signal?: AbortSignal): Promise<T>
}

export function createToolScheduler(limit = DEFAULT_TOOL_CONCURRENCY): ToolScheduler {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError(`toolConcurrency must be a positive integer, got ${limit}`)
  interface Waiter {
    exclusive: boolean
    start: () => void
  }
  const queue: Waiter[] = []
  let shared = 0
  let exclusive = false
  const admits = (waiter: Waiter) => !exclusive && (waiter.exclusive ? shared === 0 : shared < limit)
  const pump = () => {
    while (queue[0] && admits(queue[0])) {
      const waiter = queue.shift()!
      if (waiter.exclusive) exclusive = true
      else shared++
      waiter.start()
    }
  }

  return {
    run(effect, task, signal) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new Error(OPERATION_ABORTED))
        const waiter: Waiter = {
          exclusive: effect !== 'read',
          start: () => {
            signal?.removeEventListener('abort', onAbort)
            // 先释放再兑现：下一个调用在本调用的结果交回 pi 之前取得执行槽。
            const release = () => {
              if (waiter.exclusive) exclusive = false
              else shared--
              pump()
            }
            let pending
            try {
              pending = task()
            } catch (error) {
              pending = Promise.reject(error)
            }
            pending.then(
              (value) => {
                release()
                resolve(value)
              },
              (error: unknown) => {
                release()
                reject(error)
              },
            )
          },
        }
        const onAbort = () => {
          const at = queue.indexOf(waiter)
          if (at < 0) return
          queue.splice(at, 1)
          reject(new Error(OPERATION_ABORTED))
          pump()
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        queue.push(waiter)
        pump()
      })
    },
  }
}

export interface SchedulingOptions {
  scheduler: ToolScheduler
  /** 幂等键的 Session 部分。 */
  sessionId: string
  outputDirectory?: string
  /**
   * 提交 side-effect 调用的执行记录，在取得执行槽之后、execute 之前。拒绝时调用不执行，拒绝原因成为该调用的错误；
   * 让 Run 以 commit_failed 结束由调用方负责。
   */
  recordExecution: (record: ToolExecPayload) => Promise<void>
  /**
   * 取得执行槽之后、执行记录之前：按执行时的事实复核调用并补充执行上下文（沙箱档位、Secrets、读取过滤）。拒绝时调用不执行，
   * 也不提交执行记录；拒绝原因成为该调用的错误。独占调用在这里看到的是同批前面调用完成之后的状态。
   */
  prepare?: (call: PreparedCall) => Promise<Partial<Omit<ToolExecutionContext, 'idempotencyKey'>> | undefined>
}

export interface PreparedCall {
  toolCallId: string
  tool: CokoTool
  params: unknown
  signal?: AbortSignal
}

/**
 * 包住工具的 execute：经调度器排队，取得执行槽后先准备（options.prepare），side-effect 调用再提交执行记录，执行上下文（幂等键与
 * 准备给出的补充）作为第五个参数交给工具。
 */
export function withScheduling(tool: CokoTool, options: SchedulingOptions): CokoTool {
  const effect: ToolEffect = tool.effect ?? 'side-effect'
  return {
    ...tool,
    execute(toolCallId, params, signal, onUpdate) {
      const context: ToolExecutionContext = {
        idempotencyKey: idempotencyKeyFor(options.sessionId, toolCallId),
        ...(options.outputDirectory ? { outputFile: toolOutputFile(options.outputDirectory, toolCallId) } : {}),
      }
      return options.scheduler.run(
        effect,
        async () => {
          const extra = await options.prepare?.({ toolCallId, tool, params, ...(signal ? { signal } : {}) })
          if (signal?.aborted) throw new Error(OPERATION_ABORTED)
          if (effect === 'side-effect') {
            await options.recordExecution({ toolCallId, toolName: tool.name, idempotencyKey: context.idempotencyKey })
            // 记录提交期间被取消：不再开始执行。
            if (signal?.aborted) throw new Error(OPERATION_ABORTED)
          }
          try {
            return await storeToolOutput(
              await tool.execute(toolCallId, params, signal, onUpdate, extra ? { ...extra, ...context } : context),
              context.outputFile,
            )
          } catch (error) {
            if (!(error instanceof Error) || !('untruncatedText' in error) || typeof error.untruncatedText !== 'string') throw error
            const result = await storeToolOutput(
              { content: [{ type: 'text', text: error.message }], details: undefined, untruncatedText: error.untruncatedText },
              context.outputFile,
            )
            throw new Error(
              result.content
                .filter((block) => block.type === 'text')
                .map((block) => block.text)
                .join('\n\n'),
              { cause: error },
            )
          }
        },
        signal,
      )
    },
  }
}
