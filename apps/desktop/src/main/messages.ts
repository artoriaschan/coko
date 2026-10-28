// main 进程原生对话框文案。renderer 文案由 i18n 包提供（后续切片）。

export interface MainMessages {
  readonly startupFailedTitle: string
  readonly startupFailedMessage: string
  readonly crashedMessage: string
  readonly quit: string
  readonly close: string
  readonly cancel: string
  readonly confirmQuitMessage: string
  readonly confirmQuitDetail: (activeRuns: number | 'unknown') => string
}

const zh: MainMessages = {
  startupFailedTitle: 'Coko',
  startupFailedMessage: 'Sidecar 启动失败',
  crashedMessage: 'Sidecar 已意外退出',
  quit: '退出',
  close: '关闭',
  cancel: '取消',
  confirmQuitMessage: '仍要退出 Coko？',
  confirmQuitDetail: (n) => (n === 'unknown' ? '可能有正在运行的任务，退出会中断它们' : `有 ${n} 个正在运行的任务，退出会中断它们`),
}

const en: MainMessages = {
  startupFailedTitle: 'Coko',
  startupFailedMessage: 'Sidecar failed to start',
  crashedMessage: 'Sidecar exited unexpectedly',
  quit: 'Quit',
  close: 'Close',
  cancel: 'Cancel',
  confirmQuitMessage: 'Quit Coko anyway?',
  confirmQuitDetail: (n) =>
    n === 'unknown' ? 'Tasks may be running. Quitting will interrupt them.' : `${n} running task${n === 1 ? '' : 's'} will be interrupted.`,
}

export function messagesFor(locale: string): MainMessages {
  return locale.toLowerCase().startsWith('zh') ? zh : en
}
