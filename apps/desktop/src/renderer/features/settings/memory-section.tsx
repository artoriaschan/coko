import { MEMORY_CONTENT_MAX, type MemoryEntry, type MemoryScope } from '@coko/protocol'
import { Button, Checkbox, cn, Input, toast, Textarea } from '@coko/ui'
import { PencilIcon, PlusIcon, SearchIcon, Trash2Icon } from 'lucide-react'
import * as React from 'react'
import { useStore } from 'zustand'
import { useChat, useLists, useCurrentSession } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { IconButton } from '../../app/icon-button.tsx'
import { configStore } from '../../stores/config-store.ts'
import { createMemoryClient, memoryStore } from '../../stores/memory-store.ts'
import { SettingsCard } from './settings-page.tsx'

const memoryClient = createMemoryClient()
/** 搜索框输入后等待的时长（毫秒），之后才发出检索。 */
const SEARCH_DEBOUNCE_MS = 200

/**
 * 设置页的 Memory 分区：记忆开关（全局 memory.enabled；项目关闭时注明）；按关键词搜索；用户级与当前 Workspace 两组条目，
 * 查看、添加、编辑与删除。
 */
export function MemorySection() {
  const { t } = useI18n()
  const activeWorkspaceId = useCurrentSession()?.workspaceId
  const draftWorkspaceId = useChat((s) => s.draftWorkspaceId)
  const workspaceId = activeWorkspaceId ?? draftWorkspaceId ?? undefined
  const workspace = useLists((s) => s.workspaces.find((w) => w.id === workspaceId))
  const status = useStore(memoryStore, (s) => s.status)
  const loadedFor = useStore(memoryStore, (s) => s.workspaceId)
  const memories = useStore(memoryStore, (s) => s.memories)
  const query = useStore(memoryStore, (s) => s.query)

  React.useEffect(() => {
    void memoryStore.getState().load(workspaceId)
    void configStore.getState().load(workspaceId)
  }, [workspaceId])

  const current = loadedFor === (workspaceId ?? null) ? memories : []
  const of = (scope: MemoryScope) => current.filter((m) => m.scope === scope)
  const emptyText = query.trim() === '' ? t('memory.empty') : t('memory.noMatches')

  return (
    <section aria-labelledby="settings-memory" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="settings-memory" className="text-ui-body-lg font-medium">
          {t('memory.title')}
        </h2>
        <p className="text-ui-small text-muted-foreground">{t('memory.description')}</p>
      </div>
      <MemoryToggle workspaceId={workspaceId} />
      <MemorySearch />
      {status === 'error' ? (
        <p className="text-ui-body text-muted-foreground">{t('memory.loadFailed')}</p>
      ) : (
        <>
          <MemoryGroup scope="user" title={t('memory.user')} memories={of('user')} emptyText={emptyText} />
          {workspaceId !== undefined ? (
            <MemoryGroup scope="workspace" title={t('memory.workspace', { name: workspace?.name ?? '' })} memories={of('workspace')} emptyText={emptyText} />
          ) : (
            <p className="text-ui-small text-muted-foreground">{t('memory.noWorkspace')}</p>
          )}
        </>
      )}
    </section>
  )
}

/**
 * 关键词搜索：输入停止 SEARCH_DEBOUNCE_MS 后检索，清空时立即恢复列表；有内容时 Escape 只清空（不关闭设置）。
 * 检索词保存在 store 中，重新打开分区时沿用。
 */
function MemorySearch() {
  const { t } = useI18n()
  const [text, setText] = React.useState(() => memoryStore.getState().query)
  React.useEffect(() => {
    if (text === memoryStore.getState().query) return
    if (text.trim() === '') {
      void memoryStore.getState().search('')
      return
    }
    const timer = setTimeout(() => void memoryStore.getState().search(text), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [text])
  return (
    <div className="relative">
      <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        data-memory-search
        aria-label={t('memory.search')}
        placeholder={t('memory.searchPlaceholder')}
        value={text}
        autoComplete="off"
        spellCheck={false}
        className="ps-8 [&::-webkit-search-cancel-button]:hidden"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || event.nativeEvent.isComposing || text === '') return
          event.preventDefault()
          event.stopPropagation()
          setText('')
        }}
      />
    </div>
  )
}

/** 全局开关；有效值被项目设置关闭时注明。 */
function MemoryToggle({ workspaceId }: { workspaceId: string | undefined }) {
  const { t } = useI18n()
  const config = useStore(configStore, (s) => (s.workspaceId === (workspaceId ?? null) ? s.config : null))
  const [busy, setBusy] = React.useState(false)
  const id = React.useId()
  const global = config ? config.global.memory?.enabled !== false : undefined
  const blockedByProject = config !== null && global === true && !config.effective.memory.enabled
  return (
    <SettingsCard>
      <div className="flex items-start gap-3 px-4 py-3">
        <Checkbox
          id={id}
          className="mt-0.5"
          data-memory-enabled={global === undefined ? undefined : String(global)}
          checked={global ?? false}
          disabled={global === undefined || busy}
          onCheckedChange={async (checked) => {
            setBusy(true)
            try {
              await memoryClient.setEnabled(checked === true, workspaceId)
            } catch {
              toast.error(t('memory.toggleFailed'))
            } finally {
              await configStore.getState().load(workspaceId)
              setBusy(false)
            }
          }}
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <label htmlFor={id} className="text-ui-body">
            {t('memory.enabled')}
          </label>
          <span className="text-ui-small text-muted-foreground">{t('memory.enabledHint')}</span>
          {blockedByProject && <span className="text-ui-small text-destructive">{t('memory.disabledByProject')}</span>}
        </div>
      </div>
    </SettingsCard>
  )
}

const failed = (t: ReturnType<typeof useI18n>['t']) => toast.error(t('memory.saveFailed'))

function MemoryGroup({ scope, title, memories, emptyText }: { scope: MemoryScope; title: string; memories: readonly MemoryEntry[]; emptyText: string }) {
  const { t } = useI18n()
  const headingId = `memory-${scope}`
  return (
    <div className="flex flex-col gap-2" data-memory-list={scope}>
      <h3 id={headingId} className="text-ui-body font-medium">
        {title}
      </h3>
      <SettingsCard>
        {memories.length === 0 ? (
          <p data-memory-empty className="px-4 py-3 text-ui-body text-muted-foreground">
            {emptyText}
          </p>
        ) : (
          <ul aria-labelledby={headingId}>
            {memories.map((memory) => (
              <MemoryItem key={memory.id} memory={memory} />
            ))}
          </ul>
        )}
        <MemoryEditor
          className="border-t-hairline border-border px-4 py-3"
          placeholder={t('memory.addPlaceholder')}
          submitLabel={t('memory.add')}
          icon={<PlusIcon />}
          onSubmit={async (content) => {
            await memoryStore.getState().create({ scope, content })
            toast.success(t('memory.saved'))
          }}
        />
      </SettingsCard>
    </div>
  )
}

function MemoryItem({ memory }: { memory: MemoryEntry }) {
  const { t } = useI18n()
  const [editing, setEditing] = React.useState(false)
  if (editing)
    return (
      <li data-memory-id={memory.id} className="px-4 py-3 not-last:border-b-hairline not-last:border-border">
        <MemoryEditor
          initial={memory.content}
          submitLabel={t('memory.save')}
          onCancel={() => setEditing(false)}
          onSubmit={async (content) => {
            await memoryStore.getState().update(memory.id, content)
            toast.success(t('memory.saved'))
            setEditing(false)
          }}
        />
      </li>
    )
  return (
    <li
      data-memory-id={memory.id}
      data-memory-source={memory.source}
      className="flex items-start gap-3 px-4 py-2 not-last:border-b-hairline not-last:border-border"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p data-user-content className="text-ui-body break-words whitespace-pre-wrap">
          {memory.content}
        </p>
        <span className="text-ui-small text-muted-foreground">{t(`memory.sources.${memory.source}`)}</span>
      </div>
      <IconButton label={t('memory.edit')} onClick={() => setEditing(true)}>
        <PencilIcon />
      </IconButton>
      <IconButton
        label={t('memory.remove')}
        onClick={async () => {
          try {
            await memoryStore.getState().remove(memory.id)
            toast.success(t('memory.removed'))
          } catch {
            failed(t)
          }
        }}
      >
        <Trash2Icon />
      </IconButton>
    </li>
  )
}

/** 新建与编辑共用：多行输入、字数（上限 MEMORY_CONTENT_MAX）、提交与可选的取消。提交失败时保留输入。 */
function MemoryEditor({
  initial = '',
  placeholder,
  submitLabel,
  icon,
  className,
  onSubmit,
  onCancel,
}: {
  initial?: string
  placeholder?: string
  submitLabel: string
  icon?: React.ReactNode
  className?: string
  onSubmit: (content: string) => Promise<void>
  onCancel?: () => void
}) {
  const { t } = useI18n()
  const [text, setText] = React.useState(initial)
  const [busy, setBusy] = React.useState(false)
  const length = text.trim().length
  const over = length > MEMORY_CONTENT_MAX
  const countId = React.useId()
  const submit = async () => {
    if (length === 0 || over) return
    setBusy(true)
    try {
      await onSubmit(text)
      setText('')
    } catch {
      failed(t)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className={cn('flex flex-col gap-2', className)}
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <Textarea
        aria-label={t('memory.content')}
        aria-describedby={countId}
        aria-invalid={over || undefined}
        placeholder={placeholder}
        value={text}
        disabled={busy}
        rows={2}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void submit()
          } else if (event.key === 'Escape' && onCancel) {
            event.stopPropagation()
            onCancel()
          }
        }}
      />
      <div className="flex items-center justify-end gap-2">
        <span id={countId} className={cn('me-auto text-ui-small text-muted-foreground', over && 'text-destructive')}>
          {t('memory.count', { count: length, max: MEMORY_CONTENT_MAX })}
        </span>
        {onCancel && (
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
            {t('memory.cancel')}
          </Button>
        )}
        <Button type="submit" size="sm" variant="outline" disabled={busy || length === 0 || over}>
          {icon}
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
