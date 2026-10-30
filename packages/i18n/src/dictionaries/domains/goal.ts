// Goal：dock 的 Goal 卡与时间线的 Goal 行。
import { defineDomain } from './define.ts'

export const goal = defineDomain(
  {
    title: '目标',
    card: '目标',
  },
  {
    title: 'Goal',
    card: 'Goal',
  },
)
