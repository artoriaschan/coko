// Browser Mode 测试用的内存协议后端：按协议形状提供 Workspace、Session 与条目，订阅时补发并确认。
import type { ClientMessage, ServerMessage, Session, SessionEntryRecord, Workspace } from '@coko/protocol'
import type { ApiClient } from '../client/api.ts'
import type { StreamClient } from '../client/connection.ts'
import { createChatStore, type ChatStore } from '../stores/chat-store.ts'
import { createSettingsStore } from '../stores/settings-store.ts'
import { customProvider, fakeSettingsBackend } from './fake-settings.ts'

const ws = (id: string, name: string): Workspace => ({ id, path: `/Users/me/${name}`, name, createdAt: 1 })
const session = (id: string, workspaceId: string, title: string, updatedAt: number, running = false): Session => ({
  id,
  workspaceId,
  projectId: `project-${workspaceId}`,
  pinnedAt: null,
  archivedAt: null,
  title,
  model: { providerId: 'faux', modelId: 'faux-1' },
  thinkingLevel: 'off',
  modelCleared: false,
  running,
  activity: running ? 'running' : 'idle',
  createdAt: 1,
  updatedAt,
})

export const fixtureWorkspaces: Workspace[] = [ws('w-coko', 'coko'), ws('w-pi', 'pi')]

export const fixtureSessions: Session[] = [
  session('s-1', 'w-coko', '设计 token 与三栏骨架', 100),
  session('s-2', 'w-coko', 'Sidecar startup handshake', 90, true),
  session('s-3', 'w-coko', 'SQLite 迁移与租约', 80),
  session('s-4', 'w-coko', 'ripgrep contract tests', 70),
  session('s-5', 'w-coko', '', 60),
  session('s-6', 'w-coko', '工具卡 diff 展示', 50),
  session('s-7', 'w-coko', 'Forge packaging smoke', 40),
  session('s-8', 'w-pi', 'Read agent-core event flow', 30),
  session('s-9', 'w-pi', '对比 coding-agent 截断策略', 20),
]

const markdown = [
  '三栏宽度规则如下：',
  '',
  '| 区域 | 宽度 |',
  '| --- | --- |',
  '| 侧栏 | 264–420px，默认 280px，rail 56px |',
  '| 中栏 | ≥ 400px |',
  '| 右栏 | 45%，≤ 70%，≥ 300px |',
  '',
  '列宽计算：',
  '',
  '```ts',
  'const right = Math.min(frameWidth * 0.7, Math.max(300, frameWidth * 0.45))',
  "const columns = [sidebar, 'minmax(0, 1fr)', right].join(' ') // 中栏在剩余空间中伸缩，窄窗口下由 rail 让出空间",
  '```',
  '',
  '聊天列宽度为 $$\\mathrm{clamp}(680, 0.64w, 920)$$。',
].join('\n')

let seq = 0
const entry = (sessionId: string, payload: unknown, kind = 'message'): SessionEntryRecord => ({
  sessionId,
  seq: ++seq,
  kind,
  payloadVersion: 1,
  payload,
  runId: 'run-1',
  createdAt: seq,
})

function s1Entries(): SessionEntryRecord[] {
  seq = 0
  return [
    entry('s-1', { role: 'user', content: '给侧栏加上按工作区分组的会话列表，并说明三栏宽度规则。', timestamp: 0 }),
    entry('s-1', {
      role: 'assistant',
      content: [
        { type: 'text', text: '先看一下现有的侧栏。' },
        { type: 'toolCall', id: 'call-edit', name: 'edit', arguments: { path: 'src/sidebar.tsx', edits: [{ oldText: 'a', newText: 'b' }] } },
      ],
      stopReason: 'toolUse',
      timestamp: 0,
    }),
    entry('s-1', {
      role: 'toolResult',
      toolCallId: 'call-edit',
      toolName: 'edit',
      content: [{ type: 'text', text: 'Successfully replaced 1 block(s) in src/sidebar.tsx.' }],
      details: { diff: ' 1 import x\n-2 const a = 1\n+2 const b = 2\n 3 export {}', patch: '' },
      isError: false,
      timestamp: 0,
    }),
    entry('s-1', { role: 'assistant', content: [{ type: 'text', text: markdown }], stopReason: 'stop', timestamp: 0 }),
    entry('s-1', { status: 'completed' }, 'run_end'),
  ]
}

/**
 * 订阅时异步补发 afterSeq 之后的条目再确认；sendServer 可推送任意服务端消息。
 * 设置后端默认有一个 faux Provider（providers: false 时为空，用于未配置模型的场景）。sessions 替换会话列表；删除 Provider 后
 * 与 Sidecar 一样清空引用它的会话模型字段，并重新读取会话列表。
 */
export function createFixtureChat(options: { entries?: Record<string, SessionEntryRecord[]>; providers?: boolean; sessions?: Session[] } = {}) {
  let sessionList = options.sessions ?? fixtureSessions
  const entries: Record<string, SessionEntryRecord[]> = { 's-1': s1Entries(), ...options.entries }
  const messageListeners = new Set<(message: ServerMessage) => void>()
  const sent: ClientMessage[] = []
  const sendServer = (message: ServerMessage) => {
    for (const listener of messageListeners) listener(message)
  }
  const stream: StreamClient = {
    send(message) {
      sent.push(message)
      if (message.type !== 'subscribe') return true
      queueMicrotask(() => {
        for (const e of (entries[message.sessionId] ?? []).filter((x) => x.seq > message.afterSeq))
          sendServer({ type: 'entry', sessionId: message.sessionId, entry: e })
        const running = fixtureSessions.find((s) => s.id === message.sessionId)?.running ?? false
        sendServer({ type: 'subscribed', sessionId: message.sessionId, lastSeq: entries[message.sessionId]?.at(-1)?.seq ?? 0, running })
      })
      return true
    },
    onOpen: () => () => {},
    onMessage(listener) {
      messageListeners.add(listener)
      return () => messageListeners.delete(listener)
    },
  }
  const backend = fakeSettingsBackend()
  if (options.providers !== false) backend.seedProvider(customProvider('p1', ['faux-1'], { name: 'Fixture' }))
  const api = {
    ...backend.api,
    setSessionModel: async (id: string, model, thinkingLevel) => ({
      ...(fixtureSessions.find((s) => s.id === id) ?? fixtureSessions[0]!),
      model,
      thinkingLevel: thinkingLevel ?? 'off',
    }),
    listProjects: async () =>
      fixtureWorkspaces.map((workspace) => ({
        id: `project-${workspace.id}`,
        name: workspace.name,
        primaryWorkspaceId: workspace.id,
        folders: [{ path: workspace.path, primary: true }],
        pinnedAt: null,
        createdAt: workspace.createdAt,
        lastUsedAt: Math.max(workspace.createdAt, ...sessionList.filter((s) => s.projectId === `project-${workspace.id}`).map((s) => s.updatedAt)),
        sessionCount: sessionList.filter((s) => s.projectId === `project-${workspace.id}` && s.archivedAt === null).length,
      })),
    listWorkspaces: async () => fixtureWorkspaces,
    listSessions: async () => sessionList,
    deleteSession: async (id) => {
      sessionList = sessionList.filter((session) => session.id !== id && session.parentSessionId !== id)
      return { sessionIds: [id] }
    },
    renameSession: async (id, title) => {
      const current = sessionList.find((session) => session.id === id)
      if (!current) throw new Error('Session not found')
      const updated = { ...current, title: title.trim() }
      sessionList = sessionList.map((session) => (session.id === id ? updated : session))
      return updated
    },
    setSessionPinned: async (id, pinned) => {
      const current = sessionList.find((session) => session.id === id)
      if (!current) throw new Error('Session not found')
      const updated = { ...current, pinnedAt: pinned ? (current.pinnedAt ?? Date.now()) : null }
      sessionList = sessionList.map((session) => (session.id === id ? updated : session))
      return updated
    },
    registerWorkspace: async (path: string) => ws('w-new', path.split('/').at(-1) ?? path),
    createSession: async (input) => session('s-new', input.workspaceId, input.title ?? '', 200),
    firstSend: async (input) => {
      const created = {
        ...session('s-new', 'w-coko', input.text.split('\n')[0]!.slice(0, 20), 200),
        projectId: null,
        model: input.model ?? null,
        thinkingLevel: input.thinkingLevel ?? 'off',
      }
      sessionList = [...sessionList.filter((s) => s.id !== created.id), created]
      return { session: created, runId: 'run-2' }
    },
    sessionDetail: async () => {
      throw new Error('unused')
    },
    submitMessage: async () => ({ runId: 'run-2' }),
    abortRun: async () => ({ aborted: true }),
    steerRun: async () => undefined,
    pauseRun: async () => undefined,
    continueRun: async () => ({ runId: 'run-3' }),
    answerApproval: async () => undefined,
    setPermissionMode: async (_id, mode) => ({ mode, rules: [] }),
    removeSessionRule: async () => ({ mode: 'default', rules: [] }),
    listCheckpoints: async () => [],
    rewind: async (_id, request) => ({
      ...request,
      dryRun: request.dryRun ?? false,
      text: '',
      restored: [],
      deleted: [],
      diverged: [],
      untracked: [],
      outside: [],
      skipped: [],
    }),
    fork: async () => ({ sessionId: 's-1', text: '' }),
  } satisfies ApiClient
  const chat: ChatStore = createChatStore({ api, stream })
  void chat.getState().load()
  const settings = createSettingsStore({
    api,
    saveProvider: backend.saveProvider,
    providerModels: { fetchProviderModels: backend.fetchProviderModels, cancelProviderModels: backend.cancelProviderModels },
    onProviderDeleted: (id) => {
      sessionList = sessionList.map((s) => (s.model?.providerId === id ? { ...s, model: null, thinkingLevel: 'off', modelCleared: true } : s))
      void chat.getState().load()
    },
  })
  void settings.getState().load()
  return { chat, sent, sendServer, settings, backend, api }
}
