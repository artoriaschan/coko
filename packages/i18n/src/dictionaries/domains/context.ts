// 上下文用量、File Reference 与压缩（票 06、10、11）。
import { defineDomain } from './define.ts'

export const context = defineDomain(
  {
    ring: {
      label: '上下文已使用 {percent}%',
      unknown: '上下文用量',
    },
    card: {
      title: '上下文',
      usage: '{tokens} / {window} tokens',
      estimated: '含估算',
      thresholds: '自动压缩阈值 {threshold}，预警 {warning}',
      autoCompactOff: '自动压缩已关闭',
      autoCompactPaused: '自动压缩已暂停',
      breakdown: '分项（估算）',
      parts: {
        system: '系统提示',
        instructions: '指令',
        skills: 'Skills',
        memory: 'Memory',
        tools: '工具',
        messages: '消息',
      },
      instructions: '指令文件',
      noInstructions: '没有加载指令文件',
      truncated: '已截断',
      scopes: { user: '用户', project: '项目', nested: '子目录' },
      diagnostics: '诊断',
      loadFailed: '无法读取上下文用量',
    },
  },
  {
    ring: {
      label: 'Context {percent}% used',
      unknown: 'Context usage',
    },
    card: {
      title: 'Context',
      usage: '{tokens} / {window} tokens',
      estimated: 'includes estimates',
      thresholds: 'Auto-compact at {threshold}, warning at {warning}',
      autoCompactOff: 'Auto-compact is off',
      autoCompactPaused: 'Auto-compact is paused',
      breakdown: 'Breakdown (estimated)',
      parts: {
        system: 'System prompt',
        instructions: 'Instructions',
        skills: 'Skills',
        memory: 'Memory',
        tools: 'Tools',
        messages: 'Messages',
      },
      instructions: 'Instruction files',
      noInstructions: 'No instruction files loaded',
      truncated: 'Truncated',
      scopes: { user: 'User', project: 'Project', nested: 'Subdirectory' },
      diagnostics: 'Diagnostics',
      loadFailed: 'Could not load context usage',
    },
  },
)
