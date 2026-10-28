import { PanelRightCloseIcon, PanelRightOpenIcon, LoaderCircleIcon, FolderPlusIcon } from 'lucide-react'
import { Button } from '@coko/ui'
import * as React from 'react'
import type { Theme } from '../../app/appearance-store.ts'
import { useChat, useChatActions } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { IconButton } from '../../app/icon-button.tsx'
import { useSettings, useSettingsDialog } from '../../app/settings.tsx'
import type { ConnectionState } from '../../client/connection.ts'
import { ConnectionFailure, ConnectionStatus } from '../connection/connection-status.tsx'
import { Composer, type ComposerHandle } from './composer.tsx'
import { ModelPicker } from './model-picker.tsx'
import { buildTimeline } from './timeline.ts'
import { TimelineView } from './timeline-view.tsx'

export interface ConversationPaneProps {
  theme: Theme
  rightOpen: boolean
  onToggleRight: () => void
  connection: ConnectionState
  onAddWorkspace: () => void
  /** 打开日志文件夹（诊断入口）；桥接不可用时为 undefined。 */
  onOpenLogs?: (() => void) | undefined
  composerRef?: React.Ref<ComposerHandle>
}

// 聊天列宽度轴：clamp(680px, 列宽×0.64, 920px)，窄于该值时取列宽；composer 比聊天列宽 32px。
const chatColumn = 'mx-auto w-full max-w-[clamp(680px,64cqi,920px)]'
const composerColumn = 'mx-auto w-full max-w-[calc(clamp(680px,64cqi,920px)_+_32px)]'

export function ConversationPane({ theme, rightOpen, onToggleRight, connection, onAddWorkspace, onOpenLogs, composerRef }: ConversationPaneProps) {
  const { t } = useI18n()
  const activeSessionId = useChat((s) => s.activeSessionId)
  const draftWorkspaceId = useChat((s) => s.draftWorkspaceId)
  const session = useChat((s) => s.sessions.find((x) => x.id === s.activeSessionId))
  const conversation = useChat((s) => (s.activeSessionId === null ? undefined : s.conversations[s.activeSessionId]))
  const hasWorkspace = useChat((s) => s.workspaces.length > 0)
  const listStatus = useChat((s) => s.listStatus)
  const draftModel = useChat((s) => s.draftModel)
  const { send, stop, retry, openSession, selectModel } = useChatActions()
  const settingsStatus = useSettings((s) => s.status)
  const models = useSettings((s) => s.models)
  const defaultModel = useSettings((s) => s.defaultModel)
  const settingsDialog = useSettingsDialog()
  // 会话记录了模型时显示它；草稿显示已选的或默认模型。只有确认没有任何可用模型时才引导到设置。
  const model = session ? (session.model ?? defaultModel) : (draftModel ?? defaultModel)
  const needsSetup = settingsStatus === 'ready' && models.length === 0
  const items = React.useMemo(() => (conversation ? buildTimeline(conversation) : []), [conversation])
  const running = conversation?.running ?? false

  const title = session ? session.title || t('sidebar.untitled') : draftWorkspaceId !== null ? t('conversation.newSession') : ''

  // 贴底时跟随新内容；用户上翻阅读时不打断。
  const scroller = React.useRef<HTMLDivElement>(null)
  const pinned = React.useRef(true)
  React.useLayoutEffect(() => {
    const el = scroller.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [items])
  React.useLayoutEffect(() => {
    pinned.current = true
  }, [activeSessionId])

  let body: React.ReactNode
  if (listStatus === 'ready' && !hasWorkspace) {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-ui-title font-medium">{t('conversation.noWorkspaceTitle')}</p>
        <p className="max-w-100 text-ui-body text-muted-foreground">{t('conversation.noWorkspaceBody')}</p>
        <Button onClick={onAddWorkspace}>
          <FolderPlusIcon />
          {t('sidebar.addWorkspace')}
        </Button>
      </div>
    )
  } else if (conversation?.status === 'error') {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-ui-body">{t('conversation.loadFailed')}</p>
        <Button variant="outline" size="sm" onClick={() => activeSessionId && openSession(activeSessionId)}>
          {t('conversation.retry')}
        </Button>
      </div>
    )
  } else if (conversation?.status === 'loading' && conversation.entries.length === 0) {
    body = (
      <div className="flex flex-1 items-center justify-center" aria-label={t('conversation.loading')}>
        <LoaderCircleIcon aria-hidden className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none" />
      </div>
    )
  } else if (items.length === 0 && (draftWorkspaceId !== null || conversation)) {
    body = <div className="flex flex-1 items-center justify-center p-6 text-center text-ui-body text-muted-foreground">{t('conversation.emptySession')}</div>
  } else {
    body = (
      <div className={`${chatColumn} flex flex-col gap-4 py-4`}>
        <TimelineView items={items} theme={theme} onRetry={() => void retry()} />
      </div>
    )
  }

  return (
    <>
      <header
        data-window-drag
        className="flex h-(--frame-top-clearance) shrink-0 items-center gap-2 ps-[calc(16px_+_max(0px,_var(--frame-leading-clearance)_-_var(--local-sidebar-column)))] pe-2"
      >
        <h1 data-user-content={session?.title ? '' : undefined} className="min-w-0 flex-1 truncate text-ui-body-lg font-medium" title={title}>
          {title}
        </h1>
        <ConnectionStatus state={connection} />
        <IconButton label={rightOpen ? t('frame.closeRightPanel') : t('frame.openRightPanel')} aria-pressed={rightOpen} onClick={onToggleRight}>
          {rightOpen ? <PanelRightCloseIcon /> : <PanelRightOpenIcon />}
        </IconButton>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scroller}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4"
          onScroll={(event) => {
            const el = event.currentTarget
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32
          }}
        >
          {body}
        </div>

        <div className="shrink-0 px-4 pb-4">
          <Composer
            ref={composerRef}
            className={`${composerColumn} flex items-end gap-2 rounded-panel bg-background p-2 shadow-soft`}
            running={running}
            disabled={activeSessionId === null && draftWorkspaceId === null}
            needsSetup={needsSetup}
            onSend={send}
            onStop={() => void stop()}
            onSetup={() => settingsDialog.show('models')}
            accessory={
              models.length > 0 && (
                <ModelPicker
                  models={models}
                  value={model}
                  disabled={running || (activeSessionId === null && draftWorkspaceId === null)}
                  onChange={(m) => void selectModel(m)}
                />
              )
            }
          />
        </div>
        {connection.phase === 'failed' && (
          <ConnectionFailure code={connection.code} message={connection.message} crashed={connection.crashed === true} onOpenLogs={onOpenLogs} />
        )}
      </div>
    </>
  )
}
