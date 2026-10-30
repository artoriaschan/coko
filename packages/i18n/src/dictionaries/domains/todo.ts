// Todo List 与追加指令队列：输入区上方 dock 的待办卡与队列卡。
import { defineDomain } from './define.ts'

export const todo = defineDomain(
  {
    title: '待办',
    card: '待办',
    count: '待办 {done}/{total}',
    allDone: '全部完成',
    toggle: '展开或收起待办',
    waitingFor: '等待 {ids}',
    status: {
      pending: '未开始',
      in_progress: '进行中',
      completed: '已完成',
      cancelled: '已取消',
    },
    queue: {
      title: '待送达 {count}',
      hint: '当前步骤结束后送达',
    },
  },
  {
    title: 'To-dos',
    card: 'To-dos',
    count: 'To-dos {done}/{total}',
    allDone: 'All done',
    toggle: 'Expand or collapse to-dos',
    waitingFor: 'Waiting for {ids}',
    status: {
      pending: 'Not started',
      in_progress: 'In progress',
      completed: 'Completed',
      cancelled: 'Cancelled',
    },
    queue: {
      title: 'Queued {count}',
      hint: 'Delivered after the current step',
    },
  },
)
