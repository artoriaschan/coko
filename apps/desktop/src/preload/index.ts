import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type BootResult, type CokoBridge, type SetCredentialResult, type SetSecretResult, type SidecarStateEvent } from '../shared/bridge.ts'

// 只在 coko-app://app 文档中暴露；不暴露令牌、cookie 或任意 IPC。setCredential 与 setSecret 只把值交给 main，不返回值。
if (location.protocol === 'coko-app:' && location.host === 'app') {
  const bridge: CokoBridge = {
    boot: () => ipcRenderer.invoke(IPC.boot) as Promise<BootResult>,
    pickDirectory: () => ipcRenderer.invoke(IPC.pickDirectory) as Promise<string | null>,
    setCredential: (providerId, secret) => ipcRenderer.invoke(IPC.setCredential, providerId, secret) as Promise<SetCredentialResult>,
    setSecret: (name, value) => ipcRenderer.invoke(IPC.setSecret, name, value) as Promise<SetSecretResult>,
    log: (record) => ipcRenderer.send(IPC.log, record),
    openLogs: () => ipcRenderer.invoke(IPC.openLogs) as Promise<boolean>,
    onSidecarState: (listener) => {
      // 不把 IpcRendererEvent 交给 renderer。
      const handler = (_event: IpcRendererEvent, state: SidecarStateEvent) => listener(state)
      ipcRenderer.on(IPC.sidecarState, handler)
      return () => void ipcRenderer.removeListener(IPC.sidecarState, handler)
    },
  }
  contextBridge.exposeInMainWorld('coko', bridge)
}
