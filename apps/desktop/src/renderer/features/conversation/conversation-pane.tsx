import type { ImageAttachment } from '@coko/protocol'
import { ArrowDownIcon, PanelRightOpenIcon, LoaderCircleIcon, PlayIcon } from 'lucide-react'
import { AppFrameCollapsedControls, Button, cn, toast } from '@coko/ui'
import * as React from 'react'
import type { Theme } from '../../app/appearance-store.ts'
import { useNewChat, useChat, useChatActions, useChatStoreApi, useLists, useCurrentSession, useActiveWorkspaceId } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { IconButton } from '../../app/icon-button.tsx'
import { useSettings, useSettingsPage } from '../../app/settings.tsx'
import type { ConnectionState } from '../../client/connection.ts'
import { continueMode, conversationActivity, pendingApprovals, pendingConfirmations, sessionPermissionMode } from '../../stores/chat-store.ts'
import { ConnectionFailure, ConnectionStatus } from '../connection/connection-status.tsx'
import { ApiError } from '../../client/api.ts'
import { useAgentsStoreApi } from './agents-button.tsx'
import { ApprovalPanel, useChildApproval } from './approval-panel.tsx'
import { ConfirmationPanel } from './confirmation-panel.tsx'
import { Composer, type ComposerHandle } from './composer.tsx'
import { DestinationBar } from './destination-bar.tsx'
import { NewChatWelcome } from './new-chat-welcome.tsx'
import { NEW_CHAT_EDITOR_KEY } from '../../stores/new-chat-store.ts'
import { Dock } from './dock/dock.tsx'
import { isGoalCardCommand, isGoalRunningControl, useGoalStoreApi } from './dock/goal-card.tsx'
import { visibleHeaderActions, type HeaderActionDefinition, type HeaderActionProps } from './header-actions.ts'
import { PlanChip } from './plan-chip.tsx'
import { restoredMode } from './plan-review-panel.tsx'
import { openPage, type RightPanelTabId } from '../right-panel/layout-store.ts'
import { ModelPicker } from './model-picker.tsx'
import { ModePicker, nextCycledMode } from './mode-picker.tsx'
import { RewindDialog } from './rewind-dialog.tsx'
import { displayRuns } from './process-groups.ts'
import { buildTimeline } from './timeline.ts'
import { TimelineView } from './timeline-view.tsx'
import { useReadingScroll } from './use-reading-scroll.ts'
import { HandoffEffects } from './handoff-effects.tsx'
import { SessionStatusBar } from './session-status-bar.tsx'
import { SessionMenu } from './session-menu.tsx'
import { WorktreeChip, WorktreeReadOnlyNotice } from './worktree-chip.tsx'
import './conversation-header.css'

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
const sessionComposerColumn = 'mx-auto w-full max-w-[calc(clamp(680px,64cqi,920px)_+_32px)]'

/** 四个状态按钮在任何主区宽度下都直接显示。 */
export function HeaderActions({ actions, ...props }: { actions: readonly HeaderActionDefinition[] } & HeaderActionProps) {
  return (
    <div data-slot="header-actions" className="flex shrink-0 items-center gap-1">
      {actions.map(({ id, Component }) => (
        <Component key={id} {...props} />
      ))}
    </div>
  )
}

export function ConversationPane({ theme, rightOpen, onToggleRight, connection, onOpenLogs, composerRef }: ConversationPaneProps) {
  const { t } = useI18n()
  const rightTrigger = React.useRef<HTMLButtonElement>(null)
  const previousRightOpen = React.useRef(rightOpen)
  React.useLayoutEffect(() => {
    if (previousRightOpen.current && !rightOpen) rightTrigger.current?.focus()
    previousRightOpen.current = rightOpen
  }, [rightOpen])
  const activeSessionId = useChat((s) => s.activeSessionId)
  const composerColumn = activeSessionId === null ? 'mx-auto w-full max-w-[768px]' : sessionComposerColumn
  const session = useCurrentSession()
  const conversation = useChat((s) => (s.activeSessionId === null ? undefined : s.conversations[s.activeSessionId]))
  const draftModel = useNewChat((s) => s.model)
  const draftThinkingLevel = useNewChat((s) => s.thinkingLevel)
  const draftPermissionMode = useNewChat((s) => s.permissionMode)
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
  // /goal（无参数）在当前会话中打开 Goal 卡，不发送；Run 进行中的 /goal pause 与 /goal cancel 作为提交（Sidecar 的动作），不作为追加指令。
  const goals = useGoalStoreApi()
  const openGoalCard = (text: string) => {
    if (activeSessionId === null || !isGoalCardCommand(text)) return false
    goals.getState().open(activeSessionId, conversation?.entries.at(-1)?.seq ?? 0)
    return true
  }
  const sendOrOpen = async (text: string, images?: ImageAttachment[]) => (!images?.length && openGoalCard(text)) || send(text, images)
  const steerOrAct = async (text: string) => openGoalCard(text) || (isGoalRunningControl(text) ? send(text) : steer(text))
  const activeWorkspaceId = useActiveWorkspaceId()
  const workspacePath = useLists((s) => s.workspaces.find((w) => w.id === activeWorkspaceId)?.path)
  const attachmentRoot = session?.cwd ?? workspacePath
  const defaultPermissionMode = useSettings((s) => s.permissions?.defaultMode.value ?? 'default')
  const settingsStatus = useSettings((s) => s.status)
  const models = useSettings((s) => s.models)
  const defaultModel = useSettings((s) => s.defaultModel)
  const settingsPage = useSettingsPage()
  // 会话记录了模型时显示它；草稿显示已选的或默认模型。只有确认没有任何可用模型时才引导到设置。
  // 会话的模型被清空（Provider 被删除或升级时清除）时不代填默认模型：Sidecar 要求运行前重新选择。从未设置时显示默认模型，
  // 运行时 Sidecar 同样取默认模型。
  const firstModel = React.useMemo(() => (models[0] ? { providerId: models[0].providerId, modelId: models[0].modelId } : null), [models])
  const model = session ? (session.model ?? (session.modelCleared ? null : defaultModel)) : (draftModel ?? firstModel)
  const thinkingLevel = session ? session.thinkingLevel : draftThinkingLevel
  const needsSetup = settingsStatus === 'ready' && models.length === 0
  const modelRequired = session !== undefined && session.model === null && session.modelCleared && !needsSetup && models.length > 0
  // 会话：乐观的待确认模式，否则最后一条 permission_mode 条目；草稿：已选的或设置中的默认模式。
  const permissionMode = conversation
    ? (conversation.pendingMode ?? sessionPermissionMode(conversation.entries))
    : session
      ? 'default'
      : (draftPermissionMode ?? defaultPermissionMode)
  const canChangeMode = true
  const items = React.useMemo(() => (conversation ? buildTimeline(conversation) : []), [conversation])
  const running = conversation?.running ?? false
  // 同一时刻只有一张审批卡：父会话与其 running 子代理中最早的待审批请求（按条目 createdAt）接管输入区；子代理的请求回答发往子 Session。
  const ownPending = React.useMemo(() => (conversation?.running ? pendingApprovals(conversation.entries)[0] : undefined), [conversation])
  const childPending = useChildApproval(activeSessionId)
  const fromChild = childPending !== undefined && (ownPending === undefined || childPending.entry.createdAt < ownPending.createdAt) ? childPending : undefined
  const pending = fromChild ? fromChild.entry : ownPending
  const ownCall = React.useMemo(() => {
    if (!ownPending) return undefined
    const item = items.find((i) => i.kind === 'tool' && i.call.id === ownPending.payload.toolCallId)
    return item?.kind === 'tool' ? item.call : undefined
  }, [items, ownPending])
  const pendingCall = fromChild ? fromChild.call : ownCall
  const agents = useAgentsStoreApi()
  const answerPending = async (answer: Parameters<typeof answerApproval>[1]): Promise<boolean> => {
    if (!pending) return false
    if (!fromChild) return answerApproval(pending.payload.requestId, answer)
    try {
      return await agents.getState().answerApproval(fromChild.sessionId, pending.payload.requestId, answer)
    } catch (error) {
      toast.error(error instanceof ApiError && error.code === 'approval-not-pending' ? t('errors.approvalNotPending') : t('agents.approvalFailed'))
      return false
    }
  }
  // 恢复时结果不明的调用：没有 Run 时由确认卡接管输入区，同一时刻一张（最早的）。
  const confirmation = React.useMemo(() => (conversation && !conversation.running ? pendingConfirmations(conversation.entries)[0] : undefined), [conversation])
  // 输入区被接管时焦点若在其中，移到卡片上；回答后回到输入区。
  const composerArea = React.useRef<HTMLDivElement>(null)
  const cardArea = React.useRef<HTMLDivElement>(null)
  const previousCard = React.useRef<HTMLElement | null>(null)
  const lastFocused = React.useRef<EventTarget | null>(null)
  const cardKey = pending
    ? `approval:${pending.sessionId}:${pending.payload.requestId}`
    : confirmation
      ? `confirmation:${activeSessionId}:${confirmation.toolCallId}`
      : undefined
  React.useLayoutEffect(() => {
    const previous = previousCard.current
    const active = document.activeElement
    const ownedFocus =
      composerArea.current?.contains(active) ||
      previous?.contains(active) ||
      (active === document.body && lastFocused.current instanceof Node && previous?.contains(lastFocused.current))
    const next =
      cardKey === undefined
        ? null
        : (cardArea.current?.querySelector<HTMLElement>('[data-slot="approval-card"], [data-slot="confirmation-card"], [data-slot="plan-review"]') ?? null)
    previousCard.current = next
    if (!ownedFocus) return
    if (next) next.focus({ preventScroll: true })
    else if (previous) composer.current?.focus()
  }, [cardKey])
  const takenOver = pending !== undefined || confirmation !== undefined
  // 绑定的 worktree 已移除：会话只能查看（Sidecar 以 409 worktree-removed 拒绝提交），输入区换成只读提示。
  const readOnlyWorktree = session?.worktree?.status === 'removed' && !takenOver ? session.worktree : undefined
  // 回退与分叉：Run 进行中、等待审批或等待结果确认时不可用（Sidecar 同样以 409 拒绝）。目标与会话绑定：切换会话后视为关闭。
  // opened 每次打开递增，作为对话框的 key，使其本地状态随每次打开重置。
  // 关闭时保留请求只清 open，key 不变，关闭动画与焦点归还照常进行。
  const [rewindRequest, setRewindRequest] = React.useState<{ sessionId: string; seq: number; text: string; opened: number; open: boolean } | null>(null)
  const rewound = React.useRef(false)
  const archived = session?.archivedAt != null
  const actionsDisabled = running || takenOver || archived || readOnlyWorktree !== undefined
  const rewindTarget = !actionsDisabled && rewindRequest?.open === true && rewindRequest.sessionId === activeSessionId ? rewindRequest : null
  React.useEffect(() => {
    if (actionsDisabled) setRewindRequest((request) => (request?.open ? { ...request, open: false } : request))
  }, [actionsDisabled])
  // / 命令菜单的作用域；对象随 id 变化才重建。
  const commandTarget = React.useMemo(
    () => (activeSessionId !== null ? { sessionId: activeSessionId } : activeWorkspaceId ? { workspaceId: activeWorkspaceId } : undefined),
    [activeSessionId, activeWorkspaceId],
  )

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
  // 上一 Run 以暂停或中断结束：输入区上方显示横幅并带"继续"。最后一条是 assistant 文本时"继续"提交一条"继续"消息（prompt）。
  // 待确认时由确认卡接管，不显示横幅。
  const activity = conversation !== undefined && !running && conversation.status === 'ready' ? conversationActivity(conversation) : undefined
  const banner = activity === 'paused' || activity === 'interrupted' ? activity : undefined
  const resumeMode = conversation !== undefined && banner !== undefined ? continueMode(conversation) : undefined
  const continuable = resumeMode !== undefined

  const title = session ? session.title || t('sidebar.untitled') : t('conversation.newSession')
  // 所有入口打开或聚焦当前 Session 的页面；布局动作负责单例、引导页与展开规则。
  const headerActions = visibleHeaderActions()
  const openTab = React.useCallback(
    (tab: RightPanelTabId) => {
      openPage(activeSessionId, tab)
    },
    [activeSessionId],
  )

  const reading = useReadingScroll(activeSessionId, items)

  let body: React.ReactNode
  if (activeSessionId === null) {
    body = <NewChatWelcome />
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
  } else if (items.length === 0 && conversation) {
    body = <div className="flex flex-1 items-center justify-center p-6 text-center text-ui-body text-muted-foreground">{t('conversation.emptySession')}</div>
  } else {
    body = (
      <div data-slot="conversation-messages" className={`${chatColumn} flex min-w-0 flex-col gap-1 py-4`}>
        <TimelineView
          publishMainProjection
          sessionId={activeSessionId ?? undefined}
          entries={conversation?.entries}
          items={items}
          runs={conversation ? displayRuns(conversation) : undefined}
          connected={connection.phase === 'connected'}
          theme={theme}
          onRetry={() => void retry()}
          onInspect={() => openTab('trace')}
          onOpenPlan={() => openTab('plan')}
          onRewind={(seq, text) =>
            activeSessionId !== null && setRewindRequest((prev) => ({ sessionId: activeSessionId, seq, text, opened: (prev?.opened ?? 0) + 1, open: true }))
          }
          onFork={(seq) => void fork(seq)}
          onBranch={(seq) => void fork(seq, 'assistant-inclusive')}
          actionsDisabled={actionsDisabled}
          readOnly={archived || session?.worktree?.status === 'removed'}
        />
      </div>
    )
  }

  return (
    <>
      <ConnectionStatus state={connection} />
      <HandoffEffects />
      <div className="conversation-header relative shrink-0" data-session-header={activeSessionId !== null || undefined}>
        {/* 收起侧栏时标题栏左侧显示控制条；它在标题栏内，沿用标题栏的拖拽区排除规则。 */}
        <header
          data-window-drag
          className="flex h-(--frame-top-clearance) shrink-0 items-center gap-2 ps-(--local-header-leading) pe-2 @max-[560px]/main:gap-1"
        >
          <AppFrameCollapsedControls />
          {activeSessionId === null ? (
            // 新对话顶部不展示标题与连接状态；标题只作为页面名称提供给辅助技术。
            <h1 className="sr-only">{title}</h1>
          ) : (
            <>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <h1 data-user-content={session?.title ? '' : undefined} className="min-w-0 truncate text-ui-body-lg font-medium" title={title}>
                  {title}
                </h1>
                {session?.worktree && <WorktreeChip worktree={session.worktree} className="max-w-48" />}
              </div>
              {!archived && headerActions.length > 0 && <HeaderActions actions={headerActions} sessionId={activeSessionId} openTab={openTab} />}
              <SessionMenu sessionId={activeSessionId} />
              {!rightOpen && (
                <IconButton
                  ref={rightTrigger}
                  aria-keyshortcuts="Meta+Alt+B Control+Alt+B"
                  label={t('frame.openRightPanel')}
                  tooltip={t('rightPanel.toggleShortcut')}
                  tooltipSide="bottom"
                  onClick={onToggleRight}
                >
                  <PanelRightOpenIcon />
                </IconButton>
              )}
            </>
          )}
        </header>
        {activeSessionId !== null && (
          <div role="tablist" aria-label={t('frame.main')} className="flex shrink-0 border-b-hairline border-border px-4">
            <button type="button" role="tab" aria-selected="true" className="relative px-1 pt-2 pb-2.5 text-ui-body font-medium text-link focus-ring">
              {t('frame.main')}
              <span data-slot="conversation-tab-indicator" aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-link" />
            </button>
          </div>
        )}
      </div>

      <div
        onFocusCapture={(event) => {
          lastFocused.current = event.target
        }}
        className={`relative flex min-h-0 flex-1 flex-col ${activeSessionId === null ? 'justify-center overflow-y-auto' : ''}`}
      >
        <div className={activeSessionId === null ? 'contents' : 'relative flex min-h-0 flex-1 flex-col'}>
          <div
            ref={reading.ref}
            data-main-timeline-session={activeSessionId ?? undefined}
            tabIndex={activeSessionId === null ? undefined : -1}
            data-scroll-stable
            className={activeSessionId === null ? 'shrink-0 px-4' : 'conversation-message-scroll flex min-h-0 flex-1 flex-col overflow-y-auto'}
          >
            {body}
          </div>
          {activeSessionId !== null && !reading.following && reading.down && (
            <Button
              variant="outline"
              size="icon"
              aria-label={t('conversation.returnToBottom')}
              className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-round bg-background"
              onClick={reading.toBottom}
            >
              <ArrowDownIcon aria-hidden />
            </Button>
          )}
        </div>

        <div ref={cardArea} className={cn('shrink-0 px-4', activeSessionId === null ? 'pb-4' : 'pb-1')}>
          {pending && (
            <ApprovalPanel
              className={composerColumn}
              request={pending.payload}
              call={pendingCall}
              onOpenPlan={() => openTab('plan')}
              {...(fromChild ? { source: { agentType: fromChild.agentType, description: fromChild.description } } : {})}
              onAllow={() => answerPending({ decision: 'allow', scope: 'once' })}
              onAllowAlways={(scope) => answerPending({ decision: 'allow', scope })}
              onReject={(feedback) => answerPending(feedback === undefined ? { decision: 'deny' } : { decision: 'deny', feedback })}
            />
          )}
          {confirmation && !pending && (
            <ConfirmationPanel
              className={composerColumn}
              confirmation={confirmation}
              onAnswer={(answer) => answerConfirmation(confirmation.toolCallId, answer)}
            />
          )}
          {modelRequired && !takenOver && (
            <div
              role="status"
              data-slot="model-required"
              className={`${composerColumn} mb-2 rounded-panel border-hairline border-border bg-background px-3 py-2 text-ui-body text-muted-foreground`}
            >
              {t('conversation.modelRequired')}
            </div>
          )}
          {banner && !takenOver && (
            <div
              role="status"
              data-slot="run-banner"
              data-activity={banner}
              className={`${composerColumn} mb-2 flex items-center gap-3 rounded-panel border-hairline border-border bg-background px-3 py-2 text-ui-body`}
            >
              <p className="min-w-0 flex-1 text-muted-foreground">{t(banner === 'paused' ? 'conversation.pausedBanner' : 'conversation.interruptedBanner')}</p>
              {continuable && !archived && readOnlyWorktree === undefined && (
                <Button size="sm" data-action="continue" data-continue-mode={resumeMode} onClick={() => void continueRun(t('conversation.continuePrompt'))}>
                  <PlayIcon />
                  {t('conversation.continue')}
                </Button>
              )}
            </div>
          )}
          {!takenOver && !archived && <Dock sessionId={activeSessionId} className={composerColumn} />}
          {archived && (
            <p role="status" className={`${composerColumn} py-4 text-ui-body text-muted-foreground`}>
              {t('sidebar.archivedReadOnly')}
            </p>
          )}
          {readOnlyWorktree && <WorktreeReadOnlyNotice worktree={readOnlyWorktree} className={composerColumn} />}
          {/* 被审批卡或确认卡接管时保持挂载（隐藏），草稿与选区不丢。 */}
          <div ref={composerArea} hidden={takenOver || archived || readOnlyWorktree !== undefined}>
            {/* 新对话的归属栏与输入框共用一块 muted 外壳：顶部 36px 归属栏，下方是白色输入卡片。 */}
            <div
              data-slot={activeSessionId === null ? 'composer-shell' : undefined}
              className={activeSessionId === null ? cn(composerColumn, 'rounded-panel bg-muted') : undefined}
            >
              {activeSessionId === null && <DestinationBar />}
              <Composer
                ref={setComposer}
                // 放不下时控件换到编辑区下方（例如侧栏过渡中的瞬时窄宽度），不撑出横向滚动。
                className={activeSessionId === null ? 'w-full' : composerColumn}
                running={running}
                disabled={false}
                commandTarget={commandTarget}
                draftStorageKey={activeSessionId === null ? NEW_CHAT_EDITOR_KEY : undefined}
                fileWorkspaceId={activeWorkspaceId}
                fileWorkspacePath={attachmentRoot}
                needsSetup={needsSetup}
                onSend={sendOrOpen}
                supportsImages={
                  models.find((item) => item.providerId === model?.providerId && item.modelId === model?.modelId)?.input?.includes('image') === true
                }
                imageRefs={activeSessionId === null ? chatStore.newChat.getState().imageRefs : undefined}
                onImageRefsChange={activeSessionId === null ? (imageRefs) => chatStore.newChat.getState().configure({ imageRefs }) : undefined}
                onSteer={steerOrAct}
                onStop={() => void stop()}
                onPause={() => void pause()}
                pausing={conversation?.pausing ?? false}
                onSetup={() => settingsPage.open('models')}
                onCycleMode={canChangeMode ? () => void setPermissionMode(nextCycledMode(permissionMode)) : undefined}
                planChip={<PlanChip sessionId={activeSessionId} onExit={() => composer.current?.focus()} />}
                permissionControl={
                  <ModePicker
                    value={permissionMode}
                    prior={conversation ? restoredMode(conversation.entries) : 'default'}
                    disabled={!canChangeMode}
                    onChange={(m) => void setPermissionMode(m)}
                  />
                }
                accessory={
                  <ModelPicker models={models} value={model} thinkingLevel={thinkingLevel} disabled={running} onChange={(m, level) => selectModel(m, level)} />
                }
              />
            </div>
          </div>
          {activeSessionId !== null && <SessionStatusBar key={activeSessionId} sessionId={activeSessionId} className={composerColumn} />}
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
