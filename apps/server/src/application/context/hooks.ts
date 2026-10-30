// 外部 Hook（ADR 0013）的上下文贡献：每个 Run 一份 Hook 状态（开始后第一次需要时加载配置与批准），给出 PreToolUse / PermissionRequest 的权限
// 端口与 PostToolUse(Failure) 的观察 hook（排在登记明文替换之后，收到已脱敏的结果），以及生命周期事件：UserPromptSubmit（beforeSubmit）、
// Stop（onStop）与自动压缩的 PreCompact（beforeCompact；手动 /compact 在开始 Run 之前由 compaction 的动作运行）。没有 HookService 时为空贡献。
import type { RunHooks } from '../hooks.ts'
import type { ContextContribution, ContextContributionOptions, ContextScope } from './types.ts'

export function hooksContribution(options: ContextContributionOptions): ContextContribution {
  const service = options.hooks
  if (!service) return { name: 'hooks' }
  // 同一 Run 的权限端口、观察 hook 与请求前检查收到同一个作用域对象（session-runs.ts 每个 Run 取值一次）。
  const runs = new WeakMap<ContextScope, RunHooks>()
  const stateOf = (scope: ContextScope) => {
    let state = runs.get(scope)
    if (!state) runs.set(scope, (state = service.runState(scope)))
    return state
  }
  return {
    name: 'hooks',
    permissionHooks: (scope) => service.permissionPort(scope, stateOf(scope)),
    observeHooks: (scope) => [service.observeHook(scope, stateOf(scope))],
    // 记下 runId（hook_run 条目归属该 Run）；UserPromptSubmit 的 continue: false 在本 Run 第一次请求前停止。
    async beforeRequest(state, scope) {
      stateOf(scope).runId ??= state.runId
      const stop = scope.sessionId ? service.takePendingStop(scope.sessionId) : undefined
      return stop ? { stop } : undefined
    },
    beforeSubmit: (scope, text) => service.userPromptSubmit(scope, stateOf(scope), text),
    onStop: (scope, info) => service.stop(scope, stateOf(scope), info),
    // 手动压缩的 PreCompact 已在开始 Run 之前运行（拒绝时 400，stdout 并入 instructions），这里只处理自动压缩。
    beforeCompact: async (scope, info) => (info.trigger === 'auto' ? service.preCompact(scope, stateOf(scope), info) : undefined),
  }
}
