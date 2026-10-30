// Plan Mode：输入区的 Plan chip、右栏 Plan tab 与时间线的计划卡。
import { defineDomain } from './define.ts'

export const plan = defineDomain(
  {
    title: '计划',
    tab: '计划',
    chip: '规划',
  },
  {
    title: 'Plan',
    tab: 'Plan',
    chip: 'Planning',
  },
)
