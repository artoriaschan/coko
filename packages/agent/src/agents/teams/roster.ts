// Agent Teams（ADR 0018）的名册：由根 Session 的 agent_start v2（teammate: true）与每个子代理的最后一条 agent_end 派生，重启后照样成立。
import type { EntryLike } from '../../entries/types.ts'
import { agentEnds, agentStarts, type AgentEndPayload, type AgentStartPayload } from '../../session-entries/agents.ts'

export type TeamMemberStatus = 'running' | 'idle' | 'dismissed' | 'failed'

/** 名册中的一个 teammate（条目给出的事实）。 */
export interface RosterMember {
  agentId: string
  name: string
  start: AgentStartPayload
  startedAt: number
  /** 该成员最后一条 agent_end（每个 Run 结束一条；解散为 dismissed）。 */
  lastEnd?: AgentEndPayload
}

type Entry = EntryLike & { createdAt: number }

/** 每个子代理（agentId）最后一条 agent_end。 */
export function lastAgentEnds<E extends EntryLike>(entries: readonly E[]): Map<string, AgentEndPayload> {
  return new Map(agentEnds(entries).map((e) => [e.payload.agentId, e.payload]))
}

/** 根 Session 的 teammate（按创建顺序，含已解散）。 */
export function teamRoster(entries: readonly Entry[]): RosterMember[] {
  const ends = lastAgentEnds(entries)
  return agentStarts(entries)
    .filter((e) => e.payload.teammate === true && e.payload.name !== undefined)
    .map((e) => {
      const lastEnd = ends.get(e.payload.agentId)
      return { agentId: e.payload.agentId, name: e.payload.name!, start: e.payload, startedAt: e.createdAt, ...(lastEnd ? { lastEnd } : {}) }
    })
}

/**
 * 成员状态：进程内正在运行为 running；否则按最后一条 agent_end——dismissed、failed 照写，其余（completed、max-turns、cancelled、
 * interrupted 或还没有 agent_end）为 idle：teammate 的一个 Run 结束（含被重启中断）后仍可接收消息。
 */
export function memberStatus(member: Pick<RosterMember, 'lastEnd'>, running: boolean): TeamMemberStatus {
  if (running) return 'running'
  const status = member.lastEnd?.status
  if (status === 'dismissed') return 'dismissed'
  if (status === 'failed') return 'failed'
  return 'idle'
}

/** 一次性子代理能否经 send_message 继续对话：completed、max-turns、failed 可以；cancelled、interrupted、dismissed 不能。 */
export const subagentReachable = (status: AgentEndPayload['status']) => status === 'completed' || status === 'max-turns' || status === 'failed'
