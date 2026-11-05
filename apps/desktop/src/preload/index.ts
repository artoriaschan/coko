import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type BootResult,
  type CokoBridge,
  type FetchProviderModelsResult,
  type SaveProviderResult,
  type SetSecretResult,
  type SidecarStateEvent,
  type UpdateStatus,
} from '../shared/bridge.ts'

// 只在 coko-app://app 文档中暴露；不暴露令牌、cookie 或任意 IPC。saveProvider、fetchProviderModels 与 setSecret 只把值交给 main，不返回值。
if (location.protocol === 'coko-app:' && location.host === 'app') {
  const bridge: CokoBridge = {
    boot: () => ipcRenderer.invoke(IPC.boot) as Promise<BootResult>,
    revealFile: (path) => ipcRenderer.invoke(IPC.revealFile, path) as Promise<boolean>,
    openFile: (path) => ipcRenderer.invoke(IPC.openFile, path) as Promise<boolean>,
    openDirectory: (path) => ipcRenderer.invoke(IPC.openDirectory, path) as Promise<boolean>,
    pickDirectory: () => ipcRenderer.invoke(IPC.pickDirectory) as Promise<string | null>,
    pickFiles: () => ipcRenderer.invoke(IPC.pickFiles) as Promise<string[]>,
    getFilePath: (file) => webUtils.getPathForFile(file),
    validatePickedFile: (path) => ipcRenderer.invoke(IPC.validatePickedFile, path) as Promise<void>,
    readPickedImage: (path) => ipcRenderer.invoke(IPC.readPickedImage, path),
    saveProvider: (input) => ipcRenderer.invoke(IPC.saveProvider, input) as Promise<SaveProviderResult>,
    fetchProviderModels: (input) => ipcRenderer.invoke(IPC.fetchProviderModels, input) as Promise<FetchProviderModelsResult>,
    cancelProviderModels: (requestKey) => ipcRenderer.send(IPC.cancelProviderModels, requestKey),
    setSecret: (name, value) => ipcRenderer.invoke(IPC.setSecret, name, value) as Promise<SetSecretResult>,
    log: (record) => ipcRenderer.send(IPC.log, record),
    openLogs: () => ipcRenderer.invoke(IPC.openLogs) as Promise<boolean>,
    onSidecarState: (listener) => {
      // 不把 IpcRendererEvent 交给 renderer。
      const handler = (_event: IpcRendererEvent, state: SidecarStateEvent) => listener(state)
      ipcRenderer.on(IPC.sidecarState, handler)
      return () => void ipcRenderer.removeListener(IPC.sidecarState, handler)
    },
    onOpenSession: (listener) => {
      // 只交出字符串 sessionId（不是字符串的值丢弃）。
      const handler = (_event: IpcRendererEvent, sessionId: unknown) => {
        if (typeof sessionId === 'string' && sessionId !== '') listener(sessionId)
      }
      ipcRenderer.on(IPC.openSession, handler)
      return () => void ipcRenderer.removeListener(IPC.openSession, handler)
    },
    onMenuClose: (listener) => {
      const handler = () => listener()
      ipcRenderer.on(IPC.menuClose, handler)
      if (ipcRenderer.listenerCount(IPC.menuClose) === 1) ipcRenderer.send(IPC.menuCloseListening, true)
      return () => {
        ipcRenderer.removeListener(IPC.menuClose, handler)
        if (ipcRenderer.listenerCount(IPC.menuClose) === 0) ipcRenderer.send(IPC.menuCloseListening, false)
      }
    },
    requestCloseWindow: () => ipcRenderer.send(IPC.requestCloseWindow),
    onUpdateStatus: (listener) => {
      const handler = (_event: IpcRendererEvent, status: UpdateStatus) => listener(status)
      ipcRenderer.on(IPC.updateStatus, handler)
      void (ipcRenderer.invoke(IPC.getUpdateStatus) as Promise<UpdateStatus>).then(listener)
      return () => void ipcRenderer.removeListener(IPC.updateStatus, handler)
    },
    checkForUpdates: () => ipcRenderer.invoke(IPC.checkForUpdates) as Promise<void>,
    installUpdate: () => ipcRenderer.invoke(IPC.installUpdate) as Promise<void>,
  }
  contextBridge.exposeInMainWorld('coko', bridge)
}
