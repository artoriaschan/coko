// 子代理（ADR 0014）：标题栏按钮、右栏 Agents tab、设置分区与时间线的通知行。当前只有占位文案，由子代理的实现补全。
import { defineDomain } from './define.ts'

export const agents = defineDomain(
  {
    title: '子代理',
    headerAction: '子代理',
    tab: '子代理',
    settings: '子代理',
    notification: '子代理已结束',
  },
  {
    title: 'Subagents',
    headerAction: 'Subagents',
    tab: 'Agents',
    settings: 'Agents',
    notification: 'Subagent finished',
  },
)
