import { filePaths, WorkspaceFilesResponse, type Session, type WorkspaceFileEntry } from '@coko/protocol'
import { ComposerTypeahead, type ComposerTypeaheadItem, type ComposerTypeaheadSelection } from '@coko/ui'
import { Value } from 'typebox/value'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import { sessionTime } from '../sidebar/session-time.ts'

export type FetchWorkspaceFiles = (workspaceId: string, query: string) => Promise<WorkspaceFileEntry[]>

/** GET /api/workspaces/:id/files：同源相对路径，经 coko-app:// 代理附加认证；响应在信任边界按 schema 校验。 */
export function httpFetchWorkspaceFiles(fetchImpl: (input: string) => Promise<Response> = (input) => fetch(input)): FetchWorkspaceFiles {
  return async (workspaceId, query) => {
    const path = `${filePaths.workspaceFiles(workspaceId)}?query=${encodeURIComponent(query)}`
    const response = await fetchImpl(path)
    const value: unknown = await response.json().catch(() => undefined)
    if (!response.ok || !Value.Check(WorkspaceFilesResponse, value)) throw new Error(`GET ${path} failed with status ${response.status}`)
    return value.files
  }
}

const defaultFetch = httpFetchWorkspaceFiles()

function isSubsequence(query: string, text: string): boolean {
  let i = 0
  for (const ch of text) if (ch === query[i] && ++i === query.length) return true
  return query.length === 0
}

/** 空查询显示的会话数与有查询时的上限。 */
const RECENT_SESSIONS = 5
const MATCHED_SESSIONS = 20
const SESSION_KEY = 'session:'

/**
 * 可引用的会话：与 projectId 同一范围（同一 Project，或都不属于任何 Project）、未归档、不是当前会话，按最近更新从新到旧。
 * 空查询取最近的几个；有查询时按标题匹配（不区分大小写，前缀在前、包含在后）。
 */
function matchSessions(sessions: readonly Session[], projectId: string | null, sessionId: string | undefined, query: string, untitled: string) {
  const scoped = sessions
    .filter((s) => s.projectId === projectId && s.archivedAt === null && s.id !== sessionId)
    .toSorted((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
    .map((s) => ({ id: s.id, title: s.title || untitled, updatedAt: s.updatedAt }))
  if (query === '') return scoped.slice(0, RECENT_SESSIONS)
  const q = query.toLowerCase()
  const prefix = scoped.filter((s) => s.title.toLowerCase().startsWith(q))
  const rest = scoped.filter((s) => !s.title.toLowerCase().startsWith(q) && s.title.toLowerCase().includes(q))
  return [...prefix, ...rest].slice(0, MATCHED_SESSIONS)
}

export interface FileMenuProps {
  /** 文件候选的 Workspace；省略时没有文件组。 */
  workspaceId?: string | undefined
  /** 界面已持有的会话列表；与 projectId 都给出时显示会话组。 */
  sessions?: readonly Session[] | undefined
  /** 会话候选的范围：当前会话或新对话草稿所属的 Project，null 为独立对话。 */
  projectId?: string | null | undefined
  /** 当前会话：不出现在会话候选中。 */
  sessionId?: string | undefined
  /** 测试注入；缺省经 Sidecar 读取。 */
  fetchFiles?: FetchWorkspaceFiles
}

/**
 * composer 的 @ 菜单：词首输入 @ 时显示文件组与会话组，同一段查询同时过滤两组。文件按查询向 Sidecar 请求候选（模糊匹配，遵守忽略规则，
 * 目录带 /），新结果到达前，上一次的结果按子序列过滤后先显示；Enter 或指针选中插入 File Reference 节点，目录上按 Tab 替换为 "@目录/"
 * 并继续列出其中的项。会话取自传入的会话列表，不请求 Sidecar；选中插入 Session Reference 节点，标题为选中时的快照。
 */
export function FileMenu({ workspaceId, sessions, projectId, sessionId, fetchFiles = defaultFetch }: FileMenuProps) {
  const { t, locale } = useI18n()
  const [results, setResults] = React.useState<{ workspaceId: string; query: string; files: WorkspaceFileEntry[] } | null>(null)
  const latest = React.useRef(0)
  const onQuery = React.useCallback(
    (query: string) => {
      if (workspaceId === undefined) return
      const request = ++latest.current
      fetchFiles(workspaceId, query).then(
        (files) => {
          if (request === latest.current) setResults({ workspaceId, query, files })
        },
        () => undefined,
      )
    },
    [fetchFiles, workspaceId],
  )
  const groups = React.useMemo(
    () => [
      { id: 'files', label: t('references.group') },
      { id: 'sessions', label: t('references.sessionGroup') },
    ],
    [t],
  )
  const getItems = React.useCallback(
    (query: string): ComposerTypeaheadItem[] => {
      const q = query.toLowerCase()
      const files =
        !results || results.workspaceId !== workspaceId
          ? []
          : results.query === query
            ? results.files
            : results.files.filter((f) => isSubsequence(q, f.path.toLowerCase()))
      const now = Date.now()
      const matched = sessions === undefined || projectId === undefined ? [] : matchSessions(sessions, projectId, sessionId, query, t('sidebar.untitled'))
      return [
        ...files.map((f) => ({ key: f.path, label: f.path, group: 'files' })),
        ...matched.map((s) => ({ key: SESSION_KEY + s.id, label: s.title, trailing: sessionTime(s.updatedAt, now, locale, t), group: 'sessions' })),
      ]
    },
    [results, workspaceId, sessions, projectId, sessionId, t, locale],
  )
  const onSelect = React.useCallback((item: ComposerTypeaheadItem, how: ComposerTypeaheadSelection) => {
    if (item.group === 'sessions') return { sessionReference: { id: item.key.slice(SESSION_KEY.length), title: item.label } }
    return item.key.endsWith('/') && how === 'tab' ? `@${item.key}` : { fileReference: item.key }
  }, [])
  return (
    <ComposerTypeahead
      trigger="@"
      position="word"
      getItems={getItems}
      onQuery={onQuery}
      groups={groups}
      onSelect={onSelect}
      label={t('references.menuLabel')}
    />
  )
}
