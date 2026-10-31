// Agent Teams（ADR 0018）：Team tab、标题栏按钮与时间线紧凑行的文案由团队界面补全。
import { defineDomain } from './define.ts'

export const teams = defineDomain(
  {
    tab: '团队',
    headerAction: '团队',
    member: {
      running: '运行中',
      idle: '空闲',
      dismissed: '已解散',
      failed: '失败',
    },
  },
  {
    tab: 'Team',
    headerAction: 'Team',
    member: {
      running: 'Running',
      idle: 'Idle',
      dismissed: 'Dismissed',
      failed: 'Failed',
    },
  },
)
