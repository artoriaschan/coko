// 测试用的 M5 seam 贡献，只在 COKO_TEST_TOOLS=1 时装配（集成测试驱动 beforeSubmit 与 onStop）。产品装配不注册。
// 按提交文本中的标记触发：[m5:reject] 拒绝提交；[m5:context] 追加上下文；[m5:continue] 使该 Run 正常结束前继续一次。
import type { ContextContribution } from '../application/context/types.ts'

export const M5_SEAM_MARKERS = { reject: '[m5:reject]', context: '[m5:context]', continue: '[m5:continue]' } as const
export const M5_SEAM_REJECT_TEXT = 'Blocked by the M5 test seam'
export const M5_SEAM_CONTEXT_TEXT = 'Context from the M5 test seam'
export const M5_SEAM_CONTINUE_TEXT = 'Continue from the M5 test seam'

export function createM5SeamContribution(): ContextContribution {
  /** 下一个 Run 结束前要继续一次的 Session。 */
  const continuing = new Set<string>()
  return {
    name: 'test-m5-seam',
    async beforeSubmit(scope, text) {
      if (text.includes(M5_SEAM_MARKERS.reject)) return { reject: M5_SEAM_REJECT_TEXT }
      if (text.includes(M5_SEAM_MARKERS.continue) && scope.sessionId) continuing.add(scope.sessionId)
      if (text.includes(M5_SEAM_MARKERS.context)) return { context: M5_SEAM_CONTEXT_TEXT }
      return undefined
    },
    async onStop(scope, info) {
      if (!scope.sessionId || info.continuations > 0 || !continuing.delete(scope.sessionId)) return undefined
      return { continue: [{ type: 'text', text: M5_SEAM_CONTINUE_TEXT }] }
    },
  }
}
