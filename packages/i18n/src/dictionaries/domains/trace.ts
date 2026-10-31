// 追踪：右栏 Trace tab 与导出的文案由观测补全。
import { defineDomain } from './define.ts'

export const trace = defineDomain(
  {
    tab: '追踪',
    export: '导出',
  },
  {
    tab: 'Trace',
    export: 'Export',
  },
)
