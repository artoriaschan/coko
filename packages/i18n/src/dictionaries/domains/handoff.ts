// Handoff：标题栏的交接操作、对话框与时间线的交接行。当前只有占位文案，由 Handoff 的实现补全。
import { defineDomain } from './define.ts'

export const handoff = defineDomain(
  {
    title: '交接',
    headerAction: '交接',
    row: '已交接',
  },
  {
    title: 'Hand off',
    headerAction: 'Hand off',
    row: 'Handed off',
  },
)
