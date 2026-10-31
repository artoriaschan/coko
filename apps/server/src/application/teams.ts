// Agent Teams（ADR 0018）的应用服务：名册（由 agent_start / agent_end 派生）、任务板（team_task 条目）与消息送达。当前为空实现。
import type { TeamSnapshot } from '@coko/protocol'
import type { SessionStore } from '@coko/session'
import { requireSession } from './session-runtimes.ts'

export interface TeamServiceOptions {
  store: Pick<SessionStore, 'sessions'>
}

export class TeamService {
  readonly #options: TeamServiceOptions

  constructor(options: TeamServiceOptions) {
    this.#options = options
  }

  /** GET /api/sessions/:id/team：Session 不存在时 404；当前名册与任务板为空。 */
  async snapshot(sessionId: string): Promise<TeamSnapshot> {
    await requireSession(this.#options.store as SessionStore, sessionId)
    return { members: [], tasks: [], warnings: [] }
  }
}
