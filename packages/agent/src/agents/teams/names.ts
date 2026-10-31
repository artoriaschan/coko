// teammate 的名字（ADR 0018）：[a-z][a-z0-9-]{0,31}，lead 保留给根 Session，在根 Session 的未解散成员中唯一。
import { TEAMMATE_NAME_PATTERN } from '../../session-entries/agents.ts'

/** lead 在团队消息与任务板中的名字（根 Session）。 */
export const TEAM_LEAD_NAME = 'lead'
/** 每个根 Session 未解散的 teammate 上限。 */
export const MAX_TEAMMATES = 8
/** send_message 的正文上限（字符）。 */
export const TEAM_MESSAGE_BODY_MAX = 8000
/** send_message 的广播目标。 */
export const TEAM_BROADCAST = '*'

const pattern = new RegExp(TEAMMATE_NAME_PATTERN)

/** 名字不合规时的说明；合规时 undefined。 */
export function teammateNameProblem(name: string): string | undefined {
  if (name === TEAM_LEAD_NAME) return `"${TEAM_LEAD_NAME}" is reserved for the lead`
  if (!pattern.test(name)) return `Teammate names are lowercase letters, digits and "-", start with a letter and have at most 32 characters`
  return undefined
}
