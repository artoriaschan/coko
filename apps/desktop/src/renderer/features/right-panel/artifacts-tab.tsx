import type { Artifact } from '@coko/protocol'
import { toast } from '@coko/ui'
import { ChevronDownIcon, ChevronRightIcon, CopyIcon, FileIcon, FolderIcon, FolderSearchIcon, LoaderCircleIcon, RefreshCwIcon } from 'lucide-react'
import * as React from 'react'
import { IconButton } from '../../app/icon-button.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { artifactsClient } from '../../client/artifacts.ts'
import type { RightPanelTabProps } from './tabs.ts'

type Action = 'open' | 'reveal' | 'copy'
type ArtifactAction = (entry: Artifact, action: Action) => void
interface Snapshot {
  sessionId: string
  artifacts?: Artifact[]
  loading: boolean
  failed: boolean
}

/** Fetch while mounted. A completed request schedules the next scan, so scans never overlap. */
function useArtifacts(sessionId: string | null) {
  const [snapshot, setSnapshot] = React.useState<Snapshot>()
  const [revision, refresh] = React.useReducer((value: number) => value + 1, 0)
  React.useEffect(() => {
    if (!sessionId) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    setSnapshot((previous) => ({ ...(previous?.sessionId === sessionId ? previous : {}), sessionId, loading: true, failed: false }))
    const load = async () => {
      try {
        const artifacts = await artifactsClient.list(sessionId, controller.signal)
        if (!controller.signal.aborted) setSnapshot({ sessionId, artifacts, loading: false, failed: false })
      } catch {
        if (!controller.signal.aborted) setSnapshot((previous) => ({ ...previous, sessionId, loading: false, failed: true }))
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void load(), 1000)
      }
    }
    void load()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [sessionId, revision])
  return { snapshot: snapshot?.sessionId === sessionId ? snapshot : undefined, refresh }
}

function ArtifactNode({
  entry,
  children,
  onAction,
  pending,
}: {
  entry: Artifact
  children: ReadonlyMap<string, Artifact[]>
  onAction: ArtifactAction
  pending: boolean
}) {
  const { t, locale } = useI18n()
  const [expanded, setExpanded] = React.useState(true)
  const directory = entry.kind === 'directory'
  return (
    <li data-artifact-path={entry.path} className="min-w-0">
      <div className="flex min-w-0 items-center gap-1 rounded-md px-1 py-1 hover:bg-accent">
        <button
          type="button"
          disabled={pending && !directory}
          onClick={() => (directory ? setExpanded(!expanded) : onAction(entry, 'open'))}
          aria-label={directory ? t(expanded ? 'artifacts.collapse' : 'artifacts.expand', { name: entry.name }) : t('artifacts.open', { name: entry.name })}
          aria-expanded={directory ? expanded : undefined}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm text-start focus-ring"
        >
          {directory ? (
            expanded ? (
              <ChevronDownIcon aria-hidden className="size-3 shrink-0" />
            ) : (
              <ChevronRightIcon aria-hidden className="size-3 shrink-0" />
            )
          ) : (
            <span aria-hidden className="size-3 shrink-0" />
          )}
          {directory ? (
            <FolderIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <FileIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="flex min-w-0 flex-1 flex-col">
            <span data-user-content className="break-words text-ui-body">
              {entry.name}
            </span>
            <span data-user-content className="break-all text-ui-small text-muted-foreground">
              {entry.path}
            </span>
          </span>
        </button>
        {!directory && (
          <span className="shrink-0 text-ui-small text-muted-foreground tabular-nums">
            {new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { style: 'unit', unit: 'byte', unitDisplay: 'short' }).format(entry.size)}
          </span>
        )}
        <IconButton size="icon-xs" label={t('artifacts.reveal', { name: entry.name })} disabled={pending} onClick={() => onAction(entry, 'reveal')}>
          <FolderSearchIcon />
        </IconButton>
        <IconButton size="icon-xs" label={t('artifacts.copy', { name: entry.name })} disabled={pending} onClick={() => onAction(entry, 'copy')}>
          <CopyIcon />
        </IconButton>
      </div>
      {directory && expanded && (
        <ul className="min-w-0 ps-3">
          {(children.get(entry.path) ?? []).map((child) => (
            <ArtifactNode key={child.path} entry={child} children={children} onAction={onAction} pending={pending} />
          ))}
        </ul>
      )}
    </li>
  )
}

export function ArtifactsTab({ sessionId }: RightPanelTabProps) {
  const { t } = useI18n()
  const { snapshot, refresh } = useArtifacts(sessionId)
  const [pending, setPending] = React.useState(false)
  const artifacts = snapshot?.artifacts
  const children = new Map<string, Artifact[]>()
  for (const entry of artifacts ?? []) {
    const parent = entry.path.slice(0, Math.max(0, entry.path.lastIndexOf('/')))
    const siblings = children.get(parent) ?? []
    siblings.push(entry)
    children.set(parent, siblings)
  }
  const act: ArtifactAction = async (entry, action) => {
    if (!sessionId || pending) return
    setPending(true)
    try {
      const path = await artifactsClient.resolve(sessionId, entry.path)
      if (action === 'copy') {
        await navigator.clipboard.writeText(path)
        toast.success(t('artifacts.copied'))
      } else {
        const opened = action === 'open' ? await window.coko?.openFile(path) : await window.coko?.revealFile(path)
        if (!opened) throw new Error('Native file operation failed')
      }
    } catch {
      toast.error(t('artifacts.actionFailed'))
      refresh()
    } finally {
      setPending(false)
    }
  }
  return (
    <section aria-label={t('artifacts.tab')} data-slot="artifacts-tab" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        <span className="text-ui-small text-muted-foreground">{t('artifacts.folder')}</span>
        <IconButton size="icon-sm" label={t('artifacts.refresh')} disabled={snapshot?.loading} onClick={refresh}>
          <RefreshCwIcon />
        </IconButton>
      </div>
      {snapshot?.failed && (
        <p role="status" className="px-3 pb-2 text-ui-small text-destructive">
          {t('artifacts.loadFailed')}
        </p>
      )}
      {!artifacts && !snapshot?.failed ? (
        <div className="flex flex-1 items-center justify-center" aria-label={t('artifacts.loading')}>
          <LoaderCircleIcon aria-hidden className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none" />
        </div>
      ) : artifacts?.length ? (
        <ul aria-label={t('artifacts.files')} data-scroll-stable className="min-h-0 min-w-0 flex-1 overflow-y-auto px-2 pb-2">
          {(children.get('') ?? []).map((entry) => (
            <ArtifactNode key={entry.path} entry={entry} children={children} onAction={act} pending={pending} />
          ))}
        </ul>
      ) : (
        !snapshot?.failed && (
          <p className="flex flex-1 items-center justify-center p-6 text-center text-ui-body text-muted-foreground">{t('artifacts.empty')}</p>
        )
      )}
    </section>
  )
}
