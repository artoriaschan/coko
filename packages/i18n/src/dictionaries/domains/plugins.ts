// 插件（ADR 0017）：设置分区与批准对话框的文案由插件界面补全。
import { defineDomain } from './define.ts'

export const plugins = defineDomain(
  {
    settings: '插件',
    status: {
      'needs-approval': '等待批准',
      enabled: '已启用',
      disabled: '已停用',
      incompatible: '不兼容',
      invalid: '无效',
    },
  },
  {
    settings: 'Plugins',
    status: {
      'needs-approval': 'Needs approval',
      enabled: 'Enabled',
      disabled: 'Disabled',
      incompatible: 'Incompatible',
      invalid: 'Invalid',
    },
  },
)
