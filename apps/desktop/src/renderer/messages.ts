// 连接状态页的临时文案；UI 基础切片接入 packages/i18n 后替换。

export interface RendererMessages {
  readonly connecting: string
  readonly connected: string
  readonly disconnected: string
  readonly failed: string
}

const zh: RendererMessages = {
  connecting: '正在连接 Sidecar',
  connected: 'Sidecar 已连接',
  disconnected: 'Sidecar 连接已断开',
  failed: 'Sidecar 启动失败',
}

const en: RendererMessages = {
  connecting: 'Connecting to Sidecar',
  connected: 'Sidecar connected',
  disconnected: 'Sidecar disconnected',
  failed: 'Sidecar failed to start',
}

export function rendererMessages(locale: string): RendererMessages {
  return locale.toLowerCase().startsWith('zh') ? zh : en
}
