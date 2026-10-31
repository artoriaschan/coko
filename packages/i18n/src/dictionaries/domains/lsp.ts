// 代码智能（语言服务器）：设置分区与 lsp 工具卡的文案由代码智能补全。
import { defineDomain } from './define.ts'

export const lsp = defineDomain(
  {
    settings: '代码智能',
    state: {
      idle: '空闲',
      starting: '启动中',
      running: '运行中',
      failed: '失败',
    },
  },
  {
    settings: 'Code intelligence',
    state: {
      idle: 'Idle',
      starting: 'Starting',
      running: 'Running',
      failed: 'Failed',
    },
  },
)
