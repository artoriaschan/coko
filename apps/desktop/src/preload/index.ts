import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type BootResult, type CokoBridge } from '../shared/bridge.ts'

// 只在 coko-app://app 文档中暴露；不暴露令牌、cookie 或任意 IPC。
if (location.protocol === 'coko-app:' && location.host === 'app') {
  const bridge: CokoBridge = {
    boot: () => ipcRenderer.invoke(IPC.boot) as Promise<BootResult>,
    pickDirectory: () => ipcRenderer.invoke(IPC.pickDirectory) as Promise<string | null>,
    log: (record) => ipcRenderer.send(IPC.log, record),
  }
  contextBridge.exposeInMainWorld('coko', bridge)
}
