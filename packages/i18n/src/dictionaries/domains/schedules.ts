// 定时任务（ADR 0015）：标题栏按钮、右栏 Schedules tab、设置分区与时间线的投递行。当前只有占位文案，由定时任务的实现补全。
import { defineDomain } from './define.ts'

export const schedules = defineDomain(
  {
    title: '定时任务',
    headerAction: '定时任务',
    tab: '定时任务',
    settings: '定时任务',
    fire: '定时任务已投递',
  },
  {
    title: 'Scheduled tasks',
    headerAction: 'Scheduled tasks',
    tab: 'Schedules',
    settings: 'Scheduled tasks',
    fire: 'Scheduled task delivered',
  },
)
