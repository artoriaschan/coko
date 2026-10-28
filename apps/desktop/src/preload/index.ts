import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type BootResult, type CokoBridge, type SetCredentialResult } from '../shared/bridge.ts'

// 只在 coko-app://app 文档中暴露；不暴露令牌、cookie 或任意 IPC。setCredential 只把密钥交给 main，不返回密钥。
if (location.protocol === 'coko-app:' && location.host === 'app') {
  const bridge: CokoBridge = {
    boot: () => ipcRenderer.invoke(IPC.boot) as Promise<BootResult>,
    pickDirectory: () => ipcRenderer.invoke(IPC.pickDirectory) as Promise<string | null>,
    setCredential: (providerId, secret) => ipcRenderer.invoke(IPC.setCredential, providerId, secret) as Promise<SetCredentialResult>,
  }
  contextBridge.exposeInMainWorld('coko', bridge)
}
