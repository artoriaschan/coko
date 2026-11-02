import { PermissionMode, SessionModel, ThinkingLevel } from '@coko/protocol'
import { Type } from 'typebox'
import { Value } from 'typebox/value'
import { createStore, type StoreApi } from 'zustand/vanilla'

export const NEW_CHAT_EDITOR_KEY = 'coko.draft.new-chat'
export const NEW_CHAT_CONFIG_KEY = 'coko.new-chat.v1'
const SavedDraft = Type.Object({
  projectId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  branch: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  newWorktree: Type.Optional(Type.Boolean()),
  draftId: Type.String({ minLength: 1, maxLength: 200 }),
  model: Type.Union([SessionModel, Type.Null()]),
  thinkingLevel: ThinkingLevel,
  permissionMode: Type.Union([PermissionMode, Type.Null()]),
})
export interface NewChatState {
  draftId: string
  projectId: string | null
  branch: string | null
  newWorktree: boolean
  model: SessionModel | null
  thinkingLevel: ThinkingLevel
  permissionMode: PermissionMode | null
  sending: boolean
}
export interface NewChatActions {
  configure(patch: Partial<Pick<NewChatState, 'model' | 'thinkingLevel' | 'permissionMode' | 'branch' | 'newWorktree'>>): void
  selectProject(projectId: string | null): void
  setSending(sending: boolean): void
  accepted(draftId: string): void
}
export type NewChatStore = StoreApi<NewChatState & NewChatActions>
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>
const fresh = (): NewChatState => ({
  draftId: crypto.randomUUID(),
  projectId: null,
  branch: null,
  newWorktree: false,
  model: null,
  thinkingLevel: 'off',
  permissionMode: null,
  sending: false,
})

/** 一份新对话的配置；文字与 File Reference EditorState 用 NEW_CHAT_EDITOR_KEY 持久化。 */
export function createNewChatStore(storage: Storage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): NewChatStore {
  let initial = fresh()
  try {
    const saved: unknown = JSON.parse(storage?.getItem(NEW_CHAT_CONFIG_KEY) ?? 'null')
    if (Value.Check(SavedDraft, saved)) initial = { ...initial, ...saved, sending: false }
    const obsolete: string[] = []
    for (let i = 0; storage && i < storage.length; i++) {
      const key = storage.key(i)
      if (key?.startsWith('coko.draft.workspace.')) obsolete.push(key)
    }
    for (const key of obsolete) storage?.removeItem(key)
  } catch {
    /* 无可用存储时草稿继续保留在窗口内。 */
  }
  const store = createStore<NewChatState & NewChatActions>()((set, get) => ({
    ...initial,
    configure: (patch) => set(patch),
    selectProject(projectId) {
      if (get().projectId !== projectId || projectId === null) set({ projectId, branch: null, newWorktree: false })
    },
    setSending: (sending) => set({ sending }),
    accepted(draftId) {
      if (get().draftId === draftId) set(fresh())
    },
  }))
  store.subscribe(({ draftId, model, thinkingLevel, permissionMode, projectId, branch, newWorktree }) => {
    try {
      storage?.setItem(NEW_CHAT_CONFIG_KEY, JSON.stringify({ draftId, model, thinkingLevel, permissionMode, projectId, branch, newWorktree }))
    } catch {
      /* 配额不足不丢失当前草稿。 */
    }
  })
  return store
}
