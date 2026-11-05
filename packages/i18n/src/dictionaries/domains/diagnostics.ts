import { defineDomain } from './define.ts'

export const diagnostics = defineDomain(
  {
    title: '会话数据诊断',
    developer: '开发者',
    hint: '在侧边栏启用当前会话的原始数据和对话分组数据分析功能',
    conflict: '设置已在其他位置更改，已保留当前选择，请重新保存',
    saveFailed: '无法保存开发者设置，已保留当前选择，请重试',
    format: '展示形式',
    raw: '原始数据',
    grouping: '对话分组',
    empty: '暂无记录',
  },
  {
    title: 'Session diagnostics',
    developer: 'Developer',
    hint: 'Enable analysis of raw data and conversation groups for the current session in the sidebar',
    conflict: 'Settings changed elsewhere. Your selection is kept; save it again.',
    saveFailed: 'Could not save developer settings. Your selection is kept; try again.',
    format: 'Display format',
    raw: 'Raw data',
    grouping: 'Conversation groups',
    empty: 'No records',
  },
)
