// 用量与费用：时间线的 Run 用量行、会话标题栏的 Session 费用与 dock 的追加指令队列。
import { defineDomain } from './define.ts'

export const usage = defineDomain(
  {
    title: '用量',
    headerAction: '费用',
    queue: '待送达',
  },
  {
    title: 'Usage',
    headerAction: 'Cost',
    queue: 'Queued',
  },
)
