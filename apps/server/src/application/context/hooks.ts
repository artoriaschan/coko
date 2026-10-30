// 外部 Hook（ADR 0013）的上下文贡献：每个 Run 一份 Hook 状态（开始后第一次需要时加载配置与批准），给出 PreToolUse / PermissionRequest 的权限
// 端口与 PostToolUse(Failure) 的观察 hook（排在登记明文替换之后，收到已脱敏的结果）。没有 HookService 时为空贡献。
// 生命周期事件（UserPromptSubmit、Stop、PreCompact、Notification）由后续的 Hook 实现接入 beforeSubmit / onStop / beforeCompact。
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
    // 只记下 runId（hook_run 条目归属该 Run），不拦截请求。
    async beforeRequest(state, scope) {
      stateOf(scope).runId ??= state.runId
      return undefined
    },
  }
}
