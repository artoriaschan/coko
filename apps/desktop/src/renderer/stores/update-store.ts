import { createStore, type StoreApi } from 'zustand/vanilla'
import type { CokoBridge, UpdateStatus } from '../../shared/bridge.ts'

// 设置 → 关于的更新状态：main 的 UpdateCoordinator 经 preload 的 onUpdateStatus 推送（订阅时先给出当前状态）。
// 没有 bridge（浏览器中运行 renderer）时视为 disabled { reason: not-packaged }。

export type UpdateBridge = Pick<CokoBridge, 'onUpdateStatus' | 'checkForUpdates' | 'installUpdate'>

export interface UpdateState {
  /** 尚未收到第一次推送时为 undefined。 */
  status: UpdateStatus | undefined
  /** 进行中的请求（按钮的处理中状态）；结果仍以推送的状态为准。 */
  pending: 'check' | 'install' | undefined
}

export interface UpdateActions {
  /** 订阅推送（按引用计数，最后一个 release 退订）；返回 release。 */
  connect(): () => void
  check(): Promise<void>
  install(): Promise<void>
}

export type UpdateStore = StoreApi<UpdateState & UpdateActions>

const NO_BRIDGE: UpdateStatus = { state: 'disabled', reason: 'not-packaged' }

export function createUpdateStore(bridge: UpdateBridge | undefined): UpdateStore {
  let subscribers = 0
  let unsubscribe: (() => void) | undefined
  return createStore<UpdateState & UpdateActions>()((set, get) => {
    const run = async (kind: 'check' | 'install', call: () => Promise<void>) => {
      if (get().pending !== undefined) return
      set({ pending: kind })
      try {
        await call()
      } catch {
        // main 已把失败映射为 error 状态并推送；IPC 本身失败时保持当前状态。
      } finally {
        set({ pending: undefined })
      }
    }
    return {
      status: bridge === undefined ? NO_BRIDGE : undefined,
      pending: undefined,
      connect() {
        subscribers++
        if (subscribers === 1 && bridge !== undefined) unsubscribe = bridge.onUpdateStatus((status) => set({ status }))
        let released = false
        return () => {
          if (released) return
          released = true
          subscribers--
          if (subscribers === 0) {
            unsubscribe?.()
            unsubscribe = undefined
          }
        }
      },
      check: () => (bridge === undefined ? Promise.resolve() : run('check', () => bridge.checkForUpdates())),
      install: () => (bridge === undefined ? Promise.resolve() : run('install', () => bridge.installUpdate())),
    }
  })
}

/** 应用内共用的 store（测试经 AboutSection 的 store 参数换成自己的）。 */
export const updateStore = createUpdateStore(typeof window === 'undefined' ? undefined : window.coko)
