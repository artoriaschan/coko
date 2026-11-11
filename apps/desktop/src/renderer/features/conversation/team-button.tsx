import type { TeamMemberStatus } from '@coko/protocol'
import { cn } from '@coko/ui'
import { IconUsers } from '@tabler/icons-react'
import * as React from 'react'
import { useStore } from 'zustand'
import { useOptionalChatStoreApi } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { IconButton } from '../../app/icon-button.tsx'
import { isMemberRunning, teamStore, type SessionTeam, type TeamState, type TeamStore } from '../../stores/team-store.ts'
import type { HeaderActionProps } from './header-actions.ts'
import { useReloadOnEntryCount } from './use-reload-on-entry-count.ts'

// 团队视图共用的接线（docs/subsystems/teams.md#界面）：team store 的 context（测试可换成自己的 store）、按根会话读取与订阅 team_update、
// 成员状态点，以及会话标题栏的"团队"按钮。

const TeamStoreContext = React.createContext<TeamStore>(teamStore)

export function TeamStoreProvider({ store, children }: { store: TeamStore; children: React.ReactNode }) {
  return <TeamStoreContext.Provider value={store}>{children}</TeamStoreContext.Provider>
}

export const useTeamStoreApi = (): TeamStore => React.useContext(TeamStoreContext)

export function useTeam<T>(selector: (state: TeamState) => T): T {
  return useStore(useTeamStoreApi(), selector)
}

/** 名册或任务板的条目数变化时（包括重连后补发，期间可能错过 team_update）重新读取。 */
const TEAM_ENTRY_KINDS = ['agent_start', 'agent_end', 'team_task'] as const

/** 根会话的团队快照：把 team store 接到对话 store 的 progress（team_update），打开会话与相关条目数变化时重新读取。 */
export function useSessionTeam(sessionId: string | null): SessionTeam | undefined {
  const store = useTeamStoreApi()
  const chat = useOptionalChatStoreApi()
  React.useEffect(() => (chat ? store.getState().attach(chat.getState()) : undefined), [chat, store])
  useReloadOnEntryCount(sessionId, TEAM_ENTRY_KINDS, store.getState().load)
  return useStore(store, (s) => (sessionId === null ? undefined : s.teams[sessionId]))
}

const DOT: Record<TeamMemberStatus, string> = {
  running: 'bg-success',
  idle: 'bg-muted-foreground',
  dismissed: 'bg-border',
  failed: 'bg-destructive',
}

/** 成员状态点：颜色之外另有无障碍名称（状态名）。 */
export function MemberStatusDot({ status, className }: { status: TeamMemberStatus; className?: string }) {
  const { t } = useI18n()
  return (
    <span
      role="img"
      aria-label={t(`teams.member.${status}`)}
      data-member-status={status}
      className={cn('size-2 shrink-0 rounded-round', DOT[status], className)}
    />
  )
}

/**
 * 会话标题栏的"团队"按钮：会话有 teammate 时显示，徽标为 running 的成员数（没有时不显示徽标）；点击打开右栏的 Team tab。只显示状态
 * 并打开 tab，窄主区中留在标题栏。
 */
export function TeamButton({ sessionId, openTab }: HeaderActionProps) {
  const { t } = useI18n()
  const team = useSessionTeam(sessionId)?.team
  if (!team || team.members.length === 0) return null
  const running = team.members.filter(isMemberRunning).length
  const label = running > 0 ? t('teams.headerActionRunning', { count: running }) : t('teams.headerAction')
  return (
    <IconButton label={label} data-action="open-team" data-running={running} className="relative" onClick={() => openTab('team')}>
      <IconUsers aria-hidden />
      {running > 0 && (
        <span
          aria-hidden
          data-slot="team-badge"
          className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-round bg-primary px-1 text-ui-caption font-medium text-primary-foreground"
        >
          {running}
        </span>
      )}
    </IconButton>
  )
}
