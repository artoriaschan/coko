// 自动更新：设置 → 关于中的版本、更新状态与操作。
import { defineDomain } from './define.ts'

export const update = defineDomain(
  {
    title: '更新',
    runtime: 'Electron {electron} · Node {node}',
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
    reason: {
      'not-packaged': '只有安装的应用可以检查更新',
      'no-feed': '此版本没有配置更新源',
      unknown: '此版本不能检查更新',
    },
    versionReady: '版本 {version} 已下载，重启后安装',
    versionDownloading: '正在下载版本 {version}',
    errorDetail: '原因：{message}',
    check: '检查更新',
    install: '重启以更新',
  },
  {
    title: 'Updates',
    runtime: 'Electron {electron} · Node {node}',
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
    reason: {
      'not-packaged': 'Only the installed app can check for updates',
      'no-feed': 'This build has no update source',
      unknown: "This build can't check for updates",
    },
    versionReady: 'Version {version} is ready and installs when you restart',
    versionDownloading: 'Downloading version {version}',
    errorDetail: 'Reason: {message}',
    check: 'Check for updates',
    install: 'Restart to update',
  },
)
