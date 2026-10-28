import { PanelRightCloseIcon, PanelRightOpenIcon, LoaderCircleIcon, FolderPlusIcon, PlayIcon } from 'lucide-react'
import { Button } from '@coko/ui'
import * as React from 'react'
import type { Theme } from '../../app/appearance-store.ts'
import { useChat, useChatActions, useChatStoreApi } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { IconButton } from '../../app/icon-button.tsx'
import { useSettings, useSettingsDialog } from '../../app/settings.tsx'
import type { ConnectionState } from '../../client/connection.ts'
import { canContinue, conversationActivity, pendingApprovals, pendingConfirmations, sessionPermissionMode } from '../../stores/chat-store.ts'
import { ConnectionFailure, ConnectionStatus } from '../connection/connection-status.tsx'
import { ApprovalPanel } from './approval-panel.tsx'
import { ConfirmationPanel } from './confirmation-panel.tsx'
import { Composer, type ComposerHandle } from './composer.tsx'
import { ModelPicker } from './model-picker.tsx'
import { ModePicker, nextCycledMode } from './mode-picker.tsx'
import { RewindDialog } from './rewind-dialog.tsx'
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
  const draftPermissionMode = useChat((s) => s.draftPermissionMode)
  const {
    send,
    stop,
    retry,
    openSession,
    selectModel,
    answerApproval,
    answerConfirmation,
    setPermissionMode,
    steer,
    pause,
    continueRun,
    takeReturnedDraft,
    previewRewind,
    rewind,
    fork,
  } = useChatActions()
  const workspacePath = useChat((s) => s.workspaces.find((w) => w.id === session?.workspaceId)?.path)
  const defaultPermissionMode = useSettings((s) => s.permissions?.defaultMode.value ?? 'default')
  const settingsStatus = useSettings((s) => s.status)
  const models = useSettings((s) => s.models)
  const defaultModel = useSettings((s) => s.defaultModel)
  const settingsDialog = useSettingsDialog()
  // 会话记录了模型时显示它；草稿显示已选的或默认模型。只有确认没有任何可用模型时才引导到设置。
  const model = session ? (session.model ?? defaultModel) : (draftModel ?? defaultModel)
  const needsSetup = settingsStatus === 'ready' && models.length === 0
  // 会话：乐观的待确认模式，否则最后一条 permission_mode 条目；草稿：已选的或设置中的默认模式。
  const permissionMode = conversation
    ? (conversation.pendingMode ?? sessionPermissionMode(conversation.entries))
    : session
      ? 'default'
      : (draftPermissionMode ?? defaultPermissionMode)
  const canChangeMode = activeSessionId !== null || draftWorkspaceId !== null
  const items = React.useMemo(() => (conversation ? buildTimeline(conversation) : []), [conversation])
  const running = conversation?.running ?? false
  // 同一时刻只有一张审批卡：最早的待审批请求接管输入区。
  const pending = React.useMemo(() => (conversation?.running ? pendingApprovals(conversation.entries)[0] : undefined), [conversation])
  const pendingCall = React.useMemo(() => {
    if (!pending) return undefined
    const item = items.find((i) => i.kind === 'tool' && i.call.id === pending.payload.toolCallId)
    return item?.kind === 'tool' ? item.call : undefined
  }, [items, pending])
  // 恢复时结果不明的调用：没有 Run 时由确认卡接管输入区，同一时刻一张（最早的）。
  const confirmation = React.useMemo(() => (conversation && !conversation.running ? pendingConfirmations(conversation.entries)[0] : undefined), [conversation])
  // 输入区被接管时焦点若在其中，移到卡片上；回答后回到输入区。
  const composerArea = React.useRef<HTMLDivElement>(null)
  const [focusCard, setFocusCard] = React.useState(false)
  const cardKey = pending?.payload.requestId ?? confirmation?.toolCallId
  React.useLayoutEffect(() => {
    if (cardKey === undefined) return
    setFocusCard(composerArea.current?.contains(document.activeElement) ?? false)
  }, [cardKey])
  const takenOver = pending !== undefined || confirmation !== undefined
  // 回退与分叉：Run 进行中、等待审批或等待结果确认时不可用（Sidecar 同样以 409 拒绝）。目标与会话绑定：切换会话后视为关闭。
  // opened 每次打开递增，作为对话框的 key，使其本地状态随每次打开重置。
  // 关闭时保留请求只清 open，key 不变，关闭动画与焦点归还照常进行。
  const [rewindRequest, setRewindRequest] = React.useState<{ sessionId: string; seq: number; text: string; opened: number; open: boolean } | null>(null)
  const rewindTarget = rewindRequest?.open === true && rewindRequest.sessionId === activeSessionId ? rewindRequest : null
  const rewound = React.useRef(false)
  const actionsDisabled = running || takenOver

  // 外部 ref（⌘N 聚焦）与本组件的 ref（退回追加指令）指向同一个 composer。
  const composer = React.useRef<ComposerHandle | null>(null)
  const setComposer = React.useCallback(
    (handle: ComposerHandle | null) => {
      composer.current = handle
      if (typeof composerRef === 'function') composerRef(handle)
      else if (composerRef) (composerRef as React.RefObject<ComposerHandle | null>).current = handle
    },
    [composerRef],
  )
  // 停止或暂停后未送达的追加指令（以及回退、分叉的目标消息）回到输入区：订阅 store 的退回槽，取走即清空。
  // 这是 store 与命令式编辑器之间的必要桥接（编辑器内容不受 React 状态控制），不是在组件间镜像状态。
  const chatStore = useChatStoreApi()
  React.useEffect(() => {
    if (activeSessionId === null) return
    const deliver = () => {
      const draft = chatStore.getState().conversations[activeSessionId]?.returnedDraft
      if (draft === undefined || !composer.current) return
      composer.current.restore(draft)
      takeReturnedDraft(activeSessionId)
    }
    deliver()
    return chatStore.subscribe(deliver)
  }, [chatStore, activeSessionId, takeReturnedDraft])
  // 上一 Run 以暂停或中断结束：输入区上方显示横幅，模型能接着做时带"继续"。待确认时由确认卡接管，不显示横幅。
  const activity = conversation !== undefined && !running && conversation.status === 'ready' ? conversationActivity(conversation) : undefined
  const banner = activity === 'paused' || activity === 'interrupted' ? activity : undefined
  const continuable = conversation !== undefined && banner !== undefined && canContinue(conversation)

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
        <TimelineView
          items={items}
          theme={theme}
          onRetry={() => void retry()}
          onRewind={(seq, text) =>
            activeSessionId !== null && setRewindRequest((prev) => ({ sessionId: activeSessionId, seq, text, opened: (prev?.opened ?? 0) + 1, open: true }))
          }
          onFork={(seq) => void fork(seq)}
          actionsDisabled={actionsDisabled}
        />
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
          {pending && (
            <ApprovalPanel
              className={composerColumn}
              request={pending.payload}
              call={pendingCall}
              autoFocus={focusCard}
              onAllow={() => answerApproval(pending.payload.requestId, { decision: 'allow', scope: 'once' })}
              onAllowAlways={(scope) => answerApproval(pending.payload.requestId, { decision: 'allow', scope })}
              onReject={(feedback) => answerApproval(pending.payload.requestId, feedback === undefined ? { decision: 'deny' } : { decision: 'deny', feedback })}
            />
          )}
          {confirmation && !pending && (
            <ConfirmationPanel
              className={composerColumn}
              confirmation={confirmation}
              autoFocus={focusCard}
              onAnswer={(answer) => answerConfirmation(confirmation.toolCallId, answer)}
            />
          )}
          {banner && !takenOver && (
            <div
              role="status"
              data-slot="run-banner"
              data-activity={banner}
              className={`${composerColumn} mb-2 flex items-center gap-3 rounded-panel border-hairline border-border bg-background px-3 py-2 text-ui-body`}
            >
              <p className="min-w-0 flex-1 text-muted-foreground">{t(banner === 'paused' ? 'conversation.pausedBanner' : 'conversation.interruptedBanner')}</p>
              {continuable && (
                <Button size="sm" data-action="continue" onClick={() => void continueRun()}>
                  <PlayIcon />
                  {t('conversation.continue')}
                </Button>
              )}
            </div>
          )}
          {/* 被审批卡或确认卡接管时保持挂载（隐藏），草稿与选区不丢。 */}
          <div ref={composerArea} hidden={takenOver}>
            <Composer
              ref={setComposer}
              // 放不下时控件换到编辑区下方（例如侧栏过渡中的瞬时窄宽度），不撑出横向滚动。
              className={`${composerColumn} flex flex-wrap items-end gap-2 rounded-panel bg-background p-2 shadow-soft`}
              running={running}
              disabled={activeSessionId === null && draftWorkspaceId === null}
              needsSetup={needsSetup}
              onSend={send}
              onSteer={steer}
              onStop={() => void stop()}
              onPause={() => void pause()}
              pausing={conversation?.pausing ?? false}
              onSetup={() => settingsDialog.show('models')}
              onCycleMode={canChangeMode ? () => void setPermissionMode(nextCycledMode(permissionMode)) : undefined}
              accessory={
                <>
                  {/* 模式在 Run 中也可切换：立即作用于下一次调用，等待中的审批按新模式重新判定。 */}
                  <ModePicker value={permissionMode} disabled={!canChangeMode} onChange={(m) => void setPermissionMode(m)} />
                  {models.length > 0 && (
                    <ModelPicker
                      models={models}
                      value={model}
                      disabled={running || (activeSessionId === null && draftWorkspaceId === null)}
                      onChange={(m) => void selectModel(m)}
                    />
                  )}
                </>
              }
            />
          </div>
        </div>
        <RewindDialog
          key={rewindRequest?.opened ?? 0}
          target={rewindTarget}
          workspacePath={workspacePath}
          onPreview={previewRewind}
          onConfirm={async (seq, mode) => {
            const result = await rewind(seq, mode)
            rewound.current = result !== undefined
            return result !== undefined
          }}
          onClose={() => setRewindRequest((prev) => (prev ? { ...prev, open: false } : prev))}
          onCloseAutoFocus={(event) => {
            // 回退成功：目标消息已回到输入区，焦点交给输入区；取消时回到触发按钮。
            if (!rewound.current) return
            rewound.current = false
            event.preventDefault()
            composer.current?.focus()
          }}
        />
        {connection.phase === 'failed' && (
          <ConnectionFailure code={connection.code} message={connection.message} crashed={connection.crashed === true} onOpenLogs={onOpenLogs} />
        )}
      </div>
    </>
  )
}
