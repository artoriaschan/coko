// 自动更新：设置 → 关于中的更新状态与操作，文案由交付补全。
import { defineDomain } from './define.ts'

export const update = defineDomain(
  {
    state: {
      idle: '未检查',
      disabled: '不可用',
      checking: '正在检查更新…',
      available: '有可用更新',
      downloading: '正在下载更新…',
      downloaded: '更新已下载',
      'not-available': '已是最新版本',
      error: '检查更新失败',
    },
    check: '检查更新',
    install: '重启以更新',
  },
  {
    state: {
      idle: 'Not checked',
      disabled: 'Unavailable',
      checking: 'Checking for updates…',
      available: 'Update available',
      downloading: 'Downloading the update…',
      downloaded: 'Update downloaded',
      'not-available': 'You are up to date',
      error: "Couldn't check for updates",
    },
    check: 'Check for updates',
    install: 'Restart to update',
  },
)
