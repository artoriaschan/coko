// 外部 Hook（ADR 0013）：设置分区与时间线的 Hook 行。当前只有占位文案，由 Hook 的实现补全。
import { defineDomain } from './define.ts'

export const hooks = defineDomain(
  {
    title: 'Hook',
    row: 'Hook',
  },
  {
    title: 'Hooks',
    row: 'Hook',
  },
)
