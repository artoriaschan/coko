// 桌面通知：设置分区（设置键 notifications 的总开关与三类开关）。
import { defineDomain } from './define.ts'

export const notifications = defineDomain(
  {
    title: '通知',
    settings: '通知',
    description: 'Coko 不在前台时用系统通知提醒你',
    enabled: '桌面通知',
    enabledHint: '关闭后不发出任何通知',
    categories: {
      scheduleRunEnded: { label: '定时任务结束', hint: '定时任务触发的一轮执行结束时' },
      approvalWaiting: { label: '等待审批', hint: '定时任务或后台子代理需要你批准操作时' },
      agentFinished: { label: '后台子代理结束', hint: '后台运行的子代理完成、失败或被停止时' },
    },
    loading: '正在读取通知设置',
    saveFailed: '无法保存通知设置',
    conflict: '通知设置已在别处修改，已读回最新值',
  },
  {
    title: 'Notifications',
    settings: 'Notifications',
    description: "Show a system notification when Coko isn't in the foreground",
    enabled: 'Desktop notifications',
    enabledHint: 'Turn off to stop all notifications',
    categories: {
      scheduleRunEnded: { label: 'Scheduled task finished', hint: 'When a run started by a scheduled task ends' },
      approvalWaiting: { label: 'Waiting for approval', hint: 'When a scheduled task or a background subagent needs your approval' },
      agentFinished: { label: 'Background subagent finished', hint: 'When a background subagent completes, fails, or is stopped' },
    },
    loading: 'Loading notification settings',
    saveFailed: "Couldn't save notification settings",
    conflict: 'Notification settings changed elsewhere; the latest values were loaded',
  },
)
