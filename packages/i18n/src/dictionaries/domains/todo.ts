// Todo List：输入区上方 dock 的待办卡。
import { defineDomain } from './define.ts'

export const todo = defineDomain(
  {
    title: '待办',
    card: '待办',
  },
  {
    title: 'To-dos',
    card: 'To-dos',
  },
)
