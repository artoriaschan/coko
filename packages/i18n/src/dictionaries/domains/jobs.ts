// 后台任务：会话标题栏的按钮、右栏 Jobs tab 与时间线的完成通知。
import { defineDomain } from './define.ts'

export const jobs = defineDomain(
  {
    title: '后台任务',
    headerAction: '后台任务',
    tab: '后台任务',
    notification: '后台任务已结束',
  },
  {
    title: 'Background tasks',
    headerAction: 'Background tasks',
    tab: 'Tasks',
    notification: 'Background task finished',
  },
)
