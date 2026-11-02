import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { parseFileReferences } from '@coko/agent'
import type { FirstSendRequest, FirstSendResponse, ImageAttachment } from '@coko/protocol'
import type { SessionStore } from '@coko/session'
import { AppError } from './errors.ts'
import type { SessionService } from './sessions.ts'

/** 固定草稿身份对应固定的记录键，提交结果本身就是重启后的幂等凭证。 */
function sessionIdFor(draftId: string): string {
  return `chat-${createHash('sha256').update(draftId).digest('hex')}`
}
export function firstMessageTitle(text: string, images: ImageAttachment[] = []): string {
  if (!text.trim() && images.length)
    return Array.from(`附件：${images.map((image) => image.name).join('、')}`)
      .slice(0, 20)
      .join('')
  const references = parseFileReferences(text)
  let remaining = text
  for (const reference of references.toReversed()) remaining = remaining.slice(0, reference.start) + remaining.slice(reference.end)
  if (references.length > 0 && remaining.trim() === '')
    return Array.from(`附件：${[...references.map((reference) => basename(reference.path)), ...images.map((image) => image.name)].join('、')}`)
      .slice(0, 20)
      .join('')
  return Array.from((text.trim().split(/\r?\n/, 1)[0] ?? '').trim())
    .slice(0, 20)
    .join('')
}

/** 首次发送拥有目录、会话与首条消息的创建；后续发送仍由 SessionService 处理。 */
export class FirstSendService {
  readonly #pending = new Map<string, Promise<FirstSendResponse>>()
  readonly #options: { store: SessionStore; sessions: SessionService; chatsRoot: string }
  constructor(options: { store: SessionStore; sessions: SessionService; chatsRoot: string }) {
    this.#options = options
  }

  send(input: FirstSendRequest): Promise<FirstSendResponse> {
    const id = sessionIdFor(input.draftId)
    const current = this.#pending.get(id)
    if (current) return current
    const pending = this.#send(id, input)
    this.#pending.set(id, pending)
    void pending.finally(() => this.#pending.delete(id)).catch(() => {})
    return pending
  }

  async #send(id: string, input: FirstSendRequest): Promise<FirstSendResponse> {
    const { store, sessions, chatsRoot } = this.#options
    if (!input.text.trim() && !input.images?.length) throw new AppError('bad-request', 'A message is required')
    const existing = await store.sessions.getSession(id)
    if (existing) {
      const entries = await store.sessions.listEntries(id)
      const message = entries.find(
        (entry) =>
          entry.kind === 'message' &&
          typeof entry.payload === 'object' &&
          entry.payload !== null &&
          !Array.isArray(entry.payload) &&
          entry.payload.role === 'user',
      )
      if (message?.runId) return { session: await sessions.toDto(existing), runId: message.runId }
      throw new AppError('session-busy', 'An earlier first send has not been accepted')
    }
    await mkdir(chatsRoot, { recursive: true })
    const today = new Date()
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const folder = await mkdtemp(join(chatsRoot, `${date}-`))
    let workspaceId: string | undefined
    let accepted = false
    try {
      const workspace = await store.sessions.registerWorkspace({ path: await realpath(folder) })
      workspaceId = workspace.id
      const session = await sessions.create({
        id,
        workspaceId: workspace.id,
        projectId: null,
        title: firstMessageTitle(input.text, input.images),
        ...(input.model ? { model: input.model } : {}),
        ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
        ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
      })
      const result = await sessions.submitFirst(session.id, input.text, input.images)
      if (!('runId' in result)) throw new AppError('bad-request', 'A message is required')
      accepted = true
      return { session: await sessions.toDto((await store.sessions.getSession(id))!), runId: result.runId }
    } catch (error) {
      if (accepted) throw error
      if (await store.sessions.getSession(id)) await sessions.rollbackFirst(id)
      // 其他调用方已经引用这个 Workspace 时，不删除它仍在使用的目录。
      if (!workspaceId || (await store.sessions.deleteWorkspaceIfUnused(workspaceId))) await rm(folder, { recursive: true, force: true })
      throw error
    }
  }
}
