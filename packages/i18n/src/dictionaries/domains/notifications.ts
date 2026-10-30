// 桌面通知：设置分区。当前只有占位文案，由通知设置的实现补全。
import { defineDomain } from './define.ts'

export const notifications = defineDomain(
  {
    title: '通知',
    settings: '通知',
  },
  {
    title: 'Notifications',
    settings: 'Notifications',
  },
)
