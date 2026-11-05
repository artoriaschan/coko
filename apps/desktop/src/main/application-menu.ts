import type { MenuItemConstructorOptions } from 'electron'

/** 标准 role 菜单由 Electron 提供，File 的关闭动作交给 renderer 决定。 */
export function applicationMenuTemplate(platform: NodeJS.Platform, labels: { file: string; close: string }, onClose: () => void): MenuItemConstructorOptions[] {
  return [
    ...(platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { label: labels.file, submenu: [{ id: 'coko-close', label: labels.close, accelerator: 'CmdOrCtrl+W', click: onClose }] },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]
}
