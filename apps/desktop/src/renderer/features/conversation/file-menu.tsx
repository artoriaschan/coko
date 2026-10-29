import { filePaths, WorkspaceFilesResponse, type WorkspaceFileEntry } from '@coko/protocol'
import { ComposerTypeahead, type ComposerTypeaheadItem, type ComposerTypeaheadSelection } from '@coko/ui'
import { Value } from 'typebox/value'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'

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

export interface FileMenuProps {
  workspaceId: string
  /** 测试注入；缺省经 Sidecar 读取。 */
  fetchFiles?: FetchWorkspaceFiles
}

/**
 * composer 的 @ 文件菜单：词首输入 @ 时按查询向 Sidecar 请求候选（模糊匹配，遵守忽略规则，目录带 /）。新结果到达前，上一次的结果按
 * 子序列过滤后先显示。Enter 或指针选中插入 File Reference 节点；目录上按 Tab 替换为 "@目录/" 并继续列出其中的项。
 */
export function FileMenu({ workspaceId, fetchFiles = defaultFetch }: FileMenuProps) {
  const { t } = useI18n()
  const [results, setResults] = React.useState<{ workspaceId: string; query: string; files: WorkspaceFileEntry[] } | null>(null)
  const latest = React.useRef(0)
  const onQuery = React.useCallback(
    (query: string) => {
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
  const groups = React.useMemo(() => [{ id: 'files', label: t('references.group') }], [t])
  const getItems = React.useCallback(
    (query: string): ComposerTypeaheadItem[] => {
      if (!results || results.workspaceId !== workspaceId) return []
      const q = query.toLowerCase()
      const files = results.query === query ? results.files : results.files.filter((f) => isSubsequence(q, f.path.toLowerCase()))
      return files.map((f) => ({ key: f.path, label: f.path, group: 'files' }))
    },
    [results, workspaceId],
  )
  const onSelect = React.useCallback(
    (item: ComposerTypeaheadItem, how: ComposerTypeaheadSelection) => (item.key.endsWith('/') && how === 'tab' ? `@${item.key}` : { fileReference: item.key }),
    [],
  )
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
