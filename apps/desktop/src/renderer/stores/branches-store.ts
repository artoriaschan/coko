import { BranchListResponse, branchPaths, type CheckoutBranchRequest } from '@coko/protocol'
import { createStore } from 'zustand/vanilla'
import { ApiError, requestJson } from '../client/api.ts'

export interface BranchApi {
  list(id: string): Promise<BranchListResponse>
  checkout(id: string, input: CheckoutBranchRequest): Promise<BranchListResponse>
}
export function createBranchesStore(
  api: BranchApi = {
    list: (id) => requestJson(BranchListResponse, 'GET', branchPaths.project(id)),
    checkout: (id, input) => requestJson(BranchListResponse, 'POST', branchPaths.project(id), input),
  },
) {
  return createStore<{
    projects: Record<string, BranchListResponse>
    pending: boolean
    load(id: string): Promise<void>
    checkout(id: string, input: CheckoutBranchRequest): Promise<void>
  }>()((set, get) => ({
    projects: {},
    pending: false,
    async load(id) {
      const result = await api.list(id)
      set((state) => ({ projects: { ...state.projects, [id]: result } }))
    },
    async checkout(id, input) {
      if (get().pending) throw new ApiError('session-busy', 'A branch operation is already in progress', 409)
      set({ pending: true })
      try {
        const result = await api.checkout(id, input)
        set((state) => ({ projects: { ...state.projects, [id]: result } }))
      } finally {
        set({ pending: false })
      }
    },
  }))
}
export type BranchesStore = ReturnType<typeof createBranchesStore>
export const branchesStore = createBranchesStore()
