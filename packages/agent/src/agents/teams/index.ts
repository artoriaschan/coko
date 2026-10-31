// Agent Teams（ADR 0018）：teammate、团队消息与任务板。条目 payload 在 session-entries/teams.ts，宿主文本在 entries/host-input.ts。
export { TEAM_MESSAGE_TAG, teamMessageText } from '../../entries/host-input.ts'
export type { TeamMessagePayload, TeamTaskPayload, TeamTaskStatus } from '../../session-entries/teams.ts'
