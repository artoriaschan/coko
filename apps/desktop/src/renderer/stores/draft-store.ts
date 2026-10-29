// 输入区草稿（docs/subsystems/context.md）：Lexical EditorState JSON 存 localStorage，键 coko.draft.<sessionId> / coko.draft.workspace.<workspaceId>，
// 300 ms 防抖；提交被接受后清除；读出的值不是 JSON 或不是 EditorState 形状时丢弃并记 renderer warn。无 React 依赖。
import type { CommandTarget } from './commands-store.ts'

export const DRAFT_SAVE_DELAY_MS = 300

/** 草稿所属的作用域与命令目录相同：会话，或还没有会话的 Workspace 草稿。 */
export const draftKey = (target: CommandTarget) => ('sessionId' in target ? `coko.draft.${target.sessionId}` : `coko.draft.workspace.${target.workspaceId}`)

export interface DraftStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface DraftStore {
  /** 保存的 EditorState JSON；没有或已损坏时 undefined（损坏的随即删除并记 warn）。 */
  load(key: string): unknown
  /** 防抖保存：value 在写入时才取（连续输入只序列化一次）；同一键的上一次待写被替换。 */
  schedule(key: string, value: () => unknown): void
  /** 立即删除（取消该键的待写）。 */
  remove(key: string): void
  /** 编辑器拒绝了读出的内容（例如含未知节点）：删除并记 warn。 */
  discard(key: string, reason: string): void
  /** 立即写入全部待写（切换作用域、窗口关闭前）。 */
  flush(): void
}

export interface DraftStoreOptions {
  storage: DraftStorage
  warn?: (message: string, properties: Record<string, unknown>) => void
  delayMs?: number
}

const isEditorState = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && typeof (value as { root?: unknown }).root === 'object' && (value as { root: object | null }).root !== null

export function createDraftStore({ storage, warn = () => {}, delayMs = DRAFT_SAVE_DELAY_MS }: DraftStoreOptions): DraftStore {
  const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; value: () => unknown }>()
  const write = (key: string, value: () => unknown) => {
    try {
      storage.setItem(key, JSON.stringify(value()))
    } catch (error) {
      warn('draft save failed', { key, error: error instanceof Error ? error.message : String(error) })
    }
  }
  const cancel = (key: string) => {
    const entry = pending.get(key)
    if (entry) clearTimeout(entry.timer)
    pending.delete(key)
  }
  const discard = (key: string, reason: string) => {
    cancel(key)
    storage.removeItem(key)
    warn('draft discarded', { key, reason })
  }
  return {
    load(key) {
      const raw = storage.getItem(key)
      if (raw === null) return undefined
      let value: unknown
      try {
        value = JSON.parse(raw)
      } catch {
        discard(key, 'invalid-json')
        return undefined
      }
      if (!isEditorState(value)) {
        discard(key, 'invalid-editor-state')
        return undefined
      }
      return value
    },
    schedule(key, value) {
      cancel(key)
      const timer = setTimeout(() => {
        pending.delete(key)
        write(key, value)
      }, delayMs)
      pending.set(key, { timer, value })
    },
    remove(key) {
      cancel(key)
      storage.removeItem(key)
    },
    discard,
    flush() {
      for (const [key, { timer, value }] of pending) {
        clearTimeout(timer)
        pending.delete(key)
        write(key, value)
      }
    },
  }
}

let shared: DraftStore | undefined

/** 应用内共用的 store（localStorage；warn 经 preload 写入 desktop.jsonl）；窗口关闭前写入待写的草稿。 */
export function appDraftStore(): DraftStore {
  if (!shared) {
    const bridge = typeof window === 'undefined' ? undefined : window.coko
    const store = createDraftStore({
      storage: window.localStorage,
      warn: (message, properties) => {
        try {
          bridge?.log({ level: 'warning', category: ['drafts'], message, properties })
        } catch {
          // 日志转发失败不影响输入区。
        }
      },
    })
    window.addEventListener('pagehide', () => store.flush())
    window.addEventListener('beforeunload', () => store.flush())
    shared = store
  }
  return shared
}
