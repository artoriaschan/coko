// 外部 Hook（ADR 0013）：时间线的 Hook 行、工具卡的"被 Hook 阻止 / 由 Hook 允许"标注与设置分区。
import { defineDomain } from './define.ts'

export const hooks = defineDomain(
  {
    title: 'Hook',
    row: 'Hook',
    source: { global: '全局', project: '项目' },
    outcome: {
      blocked: '已阻止',
      asked: '要求确认',
      allowed: '已放行',
      denied: '已拒绝',
      context: '已追加上下文',
      continued: '要求继续',
      stopped: '已停止',
      timeout: '超时',
      error: '出错',
      'invalid-output': '输出无法解析',
    },
    blockedBy: '被 Hook 阻止',
    blockedCommand: '被 Hook 阻止：{command}',
    allowedBy: '由 Hook 允许',
    exitCode: '退出码 {code}',
  },
  {
    title: 'Hooks',
    row: 'Hook',
    source: { global: 'Global', project: 'Project' },
    outcome: {
      blocked: 'Blocked',
      asked: 'Asked to confirm',
      allowed: 'Allowed',
      denied: 'Denied',
      context: 'Added context',
      continued: 'Asked to continue',
      stopped: 'Stopped',
      timeout: 'Timed out',
      error: 'Failed',
      'invalid-output': 'Unreadable output',
    },
    blockedBy: 'Blocked by hook',
    blockedCommand: 'Blocked by hook: {command}',
    allowedBy: 'Allowed by hook',
    exitCode: 'exit {code}',
  },
)
