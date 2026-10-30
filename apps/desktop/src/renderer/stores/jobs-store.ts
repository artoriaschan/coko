import { JOB_OUTPUT_PAGE_MAX, JobOutputResponse, jobPaths, SessionJobsResponse, type JobSnapshot, type ProgressEvent } from '@coko/protocol'
import { Type } from 'typebox'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { ApiError, requestJson, type Fetch } from '../client/api.ts'

// 后台任务视图的 store（docs/subsystems/jobs.md#界面）：每个 Session 的 Job 快照（GET /api/sessions/:id/jobs 加 WS job_update），
// 以及被查看的 Job 的输出窗口（GET /api/jobs/:id/output 分页加 WS job_output 追加）。WS 帧的 offset 与 HTTP 的 offset 都是日志文件的
// 字节偏移，两者按偏移合并：重叠部分丢弃，出现缺口时从窗口末尾用 HTTP 补齐。重新打开会话时全部从接口恢复，不依赖已收到的帧。

export interface JobsBackend {
  list(sessionId: string): Promise<JobSnapshot[]>
  output(jobId: string, offset: number, limit?: number): Promise<JobOutputResponse>
  /** 204；已结束 409 job-not-running。 */
  kill(jobId: string): Promise<void>
}

const NoContent = Type.Undefined()

/** 经 requestJson（错误体与响应在信任边界按 schema 校验）。 */
export function httpJobsBackend(fetchImpl?: Fetch): JobsBackend {
  return {
    list: async (sessionId) => (await requestJson(SessionJobsResponse, 'GET', jobPaths.sessionJobs(sessionId), undefined, fetchImpl)).jobs,
    output: (jobId, offset, limit) => requestJson(JobOutputResponse, 'GET', jobPaths.output(jobId, offset, limit), undefined, fetchImpl),
    kill: async (jobId) => {
      await requestJson(NoContent, 'POST', jobPaths.kill(jobId), undefined, fetchImpl)
    },
  }
}

export interface SessionJobs {
  status: 'loading' | 'ready' | 'error'
  /** 启动顺序。 */
  jobs: JobSnapshot[]
}

/**
 * 被查看的 Job 的输出窗口：日志字节 [start, end) 的文本。start > 0 时之前的输出可以按页加载（loadEarlier）。
 * done：Job 已结束且日志已读完，之后不再有帧。
 */
export interface JobOutput {
  status: 'loading' | 'ready' | 'error'
  start: number
  end: number
  text: string
  done: boolean
  loadingEarlier: boolean
}

export interface JobsState {
  sessions: Record<string, SessionJobs>
  outputs: Record<string, JobOutput>
  /** 每个 Session 的选中项（renderer 内存）。 */
  selected: Record<string, string>
  /** 每个 Session 的"打开 Job"请求计数：标题栏按钮据此打开右栏并切到 Jobs tab（Job chip 与通知行发起）。 */
  openRequests: Record<string, number>
}

/** chat-store 的 progress 订阅（onProgress）。 */
export interface JobProgressSource {
  onProgress(listener: (progress: { sessionId: string; runId: string; event: ProgressEvent }) => void): () => void
}

export interface JobsActions {
  /** 读取 Session 的 Job 列表；较早发出的请求晚到时被丢弃，失败时保留已有列表。 */
  load(sessionId: string): Promise<void>
  select(sessionId: string, jobId: string): void
  /** 选中并请求打开右栏的 Jobs tab。 */
  open(sessionId: string, jobId: string): void
  /** 开始查看某个 Job 的输出：首次读取日志末尾一页，之后跟随 WS 帧；已结束未读完时补齐。 */
  watchOutput(jobId: string): Promise<void>
  /** 加载窗口之前的一页。 */
  loadEarlier(jobId: string): Promise<void>
  /** 停止（POST kill）；已结束（409 job-not-running）视为成功；其他错误抛给调用方。之后重新读取列表。 */
  kill(sessionId: string, jobId: string): Promise<void>
  /** 订阅 job_update / job_output 进度；同一来源只订阅一次（引用计数），返回取消订阅。 */
  attach(source: JobProgressSource): () => void
}

export type JobsStore = StoreApi<JobsState & JobsActions>

export interface JobsStoreOptions {
  /** 首次读取的末尾字节数（缺省一页 256 KB）。 */
  tailBytes?: number
  /** 窗口保留的字符数上限（缺省 1 Mi）；超出时从开头按行丢弃（之后可再加载）。 */
  retainChars?: number
}

const encoder = new TextEncoder()
const byteLength = (text: string) => encoder.encode(text).length
const decoder = new TextDecoder()
/** 从 UTF-8 文本中去掉前 n 个字节（n 落在字符边界上：两边的偏移都来自同一份日志）。 */
const dropBytes = (text: string, n: number) => decoder.decode(encoder.encode(text).subarray(n))

const ended = (job: JobSnapshot) => job.status !== 'running' && job.status !== 'stopping'

/**
 * 从中途开始读取的一页：开头可能在多字节字符中间，丢到第一个换行之后（该行之前的部分可以加载更早的输出看到）。返回实际的起点与文本。
 * 没有换行时保留全部（极少见：一页内没有换行的长行）。
 */
function alignStart(page: JobOutputResponse): { start: number; text: string } {
  if (page.offset === 0) return { start: 0, text: page.chunk }
  const newline = page.chunk.indexOf('\n')
  if (newline < 0) return { start: page.offset, text: page.chunk }
  const text = page.chunk.slice(newline + 1)
  return { start: page.nextOffset - byteLength(text), text }
}

export function createJobsStore(backend: JobsBackend = httpJobsBackend(), options: JobsStoreOptions = {}): JobsStore {
  const tailBytes = Math.max(1, Math.min(options.tailBytes ?? JOB_OUTPUT_PAGE_MAX, JOB_OUTPUT_PAGE_MAX))
  const retainChars = options.retainChars ?? 1024 * 1024
  const listRequests = new Map<string, number>()
  /** 正在补齐的 Job；补齐期间又出现缺口时补齐结束后再来一轮。 */
  const syncing = new Map<string, { again: boolean }>()
  const sources = new Map<JobProgressSource['onProgress'], { count: number; off: () => void }>()

  const store = createStore<JobsState & JobsActions>()((set, get) => {
    const patchOutput = (jobId: string, patch: Partial<JobOutput>) => {
      const current = get().outputs[jobId]
      if (current) set({ outputs: { ...get().outputs, [jobId]: { ...current, ...patch } } })
    }

    /** 把从 offset 开始的文本并入窗口末尾：重叠的部分丢弃；返回 false 表示有缺口（offset 超过窗口末尾）。 */
    const merge = (jobId: string, offset: number, chunk: string, nextOffset: number, done?: boolean): boolean => {
      const output = get().outputs[jobId]
      if (!output || output.status !== 'ready') return true
      if (offset > output.end) return false
      if (nextOffset <= output.end) {
        if (done && !output.done) patchOutput(jobId, { done: true })
        return true
      }
      const fresh = offset === output.end ? chunk : dropBytes(chunk, output.end - offset)
      let text = output.text + fresh
      let start = output.start
      // 窗口过大：从开头按行丢弃，start 前移相应的字节数（之后可以再加载）。
      if (text.length > retainChars && !output.loadingEarlier) {
        const cut = text.indexOf('\n', text.length - retainChars)
        if (cut >= 0) {
          start += byteLength(text.slice(0, cut + 1))
          text = text.slice(cut + 1)
        }
      }
      patchOutput(jobId, { text, start, end: nextOffset, ...(done ? { done: true } : {}) })
      return true
    }

    /** 从窗口末尾读到日志当前末尾（或 Job 结束）。 */
    const sync = async (jobId: string) => {
      const running = syncing.get(jobId)
      if (running) {
        running.again = true
        return
      }
      const state = { again: false }
      syncing.set(jobId, state)
      try {
        for (;;) {
          const output = get().outputs[jobId]
          if (!output || output.status !== 'ready' || output.done) break
          state.again = false
          const page = await backend.output(jobId, output.end, JOB_OUTPUT_PAGE_MAX)
          merge(jobId, page.offset, page.chunk, page.nextOffset, page.done)
          if (page.chunk === '' && !state.again) break
        }
      } catch {
        // 补齐失败：窗口保留已有内容，下一帧或下一次 job_update 再补。
      } finally {
        syncing.delete(jobId)
      }
    }

    const upsert = (job: JobSnapshot) => {
      const session = get().sessions[job.sessionId] ?? { status: 'ready' as const, jobs: [] }
      const at = session.jobs.findIndex((j) => j.jobId === job.jobId)
      const jobs = at < 0 ? [...session.jobs, job] : session.jobs.map((j, i) => (i === at ? job : j))
      set({ sessions: { ...get().sessions, [job.sessionId]: { ...session, jobs } } })
      if (ended(job) && get().outputs[job.jobId]?.done === false) void sync(job.jobId)
    }

    const onProgress = ({ event }: { sessionId: string; runId: string; event: ProgressEvent }) => {
      if (event.type === 'job_update') upsert(event.job)
      else if (event.type === 'job_output') {
        const output = get().outputs[event.jobId]
        if (!output || output.status !== 'ready' || output.done) return
        const nextOffset = event.offset + byteLength(event.chunk)
        if (!merge(event.jobId, event.offset, event.chunk, nextOffset)) void sync(event.jobId)
      }
    }

    return {
      sessions: {},
      outputs: {},
      selected: {},
      openRequests: {},

      async load(sessionId) {
        const request = (listRequests.get(sessionId) ?? 0) + 1
        listRequests.set(sessionId, request)
        const current = get().sessions[sessionId]
        if (!current) set({ sessions: { ...get().sessions, [sessionId]: { status: 'loading', jobs: [] } } })
        try {
          const listed = await backend.list(sessionId)
          if (listRequests.get(sessionId) !== request) return
          // 列表请求期间到达的 job_update 可能更新：已结束的快照不被较早的"运行中"覆盖。
          const known = new Map((get().sessions[sessionId]?.jobs ?? []).map((j) => [j.jobId, j]))
          const jobs = listed.map((job) => {
            const seen = known.get(job.jobId)
            return seen && ended(seen) && !ended(job) ? seen : job
          })
          set({ sessions: { ...get().sessions, [sessionId]: { status: 'ready', jobs } } })
          for (const job of jobs) if (ended(job) && get().outputs[job.jobId]?.done === false) void sync(job.jobId)
        } catch {
          if (listRequests.get(sessionId) !== request) return
          const jobs = get().sessions[sessionId]?.jobs ?? []
          set({ sessions: { ...get().sessions, [sessionId]: { status: 'error', jobs } } })
        }
      },

      select(sessionId, jobId) {
        set({ selected: { ...get().selected, [sessionId]: jobId } })
      },

      open(sessionId, jobId) {
        set({
          selected: { ...get().selected, [sessionId]: jobId },
          openRequests: { ...get().openRequests, [sessionId]: (get().openRequests[sessionId] ?? 0) + 1 },
        })
      },

      async watchOutput(jobId) {
        const existing = get().outputs[jobId]
        if (existing?.status === 'loading') return
        if (existing?.status === 'ready') {
          if (!existing.done) await sync(jobId)
          return
        }
        set({ outputs: { ...get().outputs, [jobId]: { status: 'loading', start: 0, end: 0, text: '', done: false, loadingEarlier: false } } })
        try {
          // 日志当前大小：offset 超出时服务端返回末尾（空块，nextOffset 为大小）。
          const probe = await backend.output(jobId, Number.MAX_SAFE_INTEGER, 1)
          const from = Math.max(0, probe.nextOffset - tailBytes)
          const page = probe.nextOffset === 0 ? probe : await backend.output(jobId, from, tailBytes)
          const { start, text } = alignStart(page)
          set({ outputs: { ...get().outputs, [jobId]: { status: 'ready', start, end: page.nextOffset, text, done: page.done, loadingEarlier: false } } })
          // 读取期间写入的输出（以及期间被忽略的帧）：补齐到末尾。
          if (!page.done) await sync(jobId)
        } catch {
          patchOutput(jobId, { status: 'error' })
        }
      },

      async loadEarlier(jobId) {
        const output = get().outputs[jobId]
        if (!output || output.status !== 'ready' || output.start === 0 || output.loadingEarlier) return
        patchOutput(jobId, { loadingEarlier: true })
        try {
          const from = Math.max(0, output.start - JOB_OUTPUT_PAGE_MAX)
          const page = await backend.output(jobId, from, output.start - from)
          const aligned = alignStart(page)
          const current = get().outputs[jobId]
          if (!current) return
          // 页的末尾就是窗口起点（服务端不在多字节字符中间结束）；只拼接正好衔接的部分。
          if (page.nextOffset !== current.start) patchOutput(jobId, { loadingEarlier: false })
          else patchOutput(jobId, { start: aligned.start, text: aligned.text + current.text, loadingEarlier: false })
        } catch {
          patchOutput(jobId, { loadingEarlier: false })
        }
      },

      async kill(sessionId, jobId) {
        try {
          await backend.kill(jobId)
        } catch (error) {
          if (!(error instanceof ApiError && error.code === 'job-not-running')) throw error
        } finally {
          void get().load(sessionId)
        }
      },

      attach(source) {
        const key = source.onProgress
        let entry = sources.get(key)
        if (!entry) {
          entry = { count: 0, off: source.onProgress(onProgress) }
          sources.set(key, entry)
        }
        entry.count++
        let attached = true
        return () => {
          if (!attached) return
          attached = false
          const current = sources.get(key)
          if (!current) return
          current.count--
          if (current.count === 0) {
            current.off()
            sources.delete(key)
          }
        }
      },
    }
  })
  return store
}

/** 应用内共用的 store。 */
export const jobsStore: JobsStore = createJobsStore()
