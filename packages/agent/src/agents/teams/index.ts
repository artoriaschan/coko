// Agent Teams（ADR 0018）：teammate、团队消息与任务板。条目 payload 在 session-entries/teams.ts，宿主文本在 entries/host-input.ts。
export { TEAM_MESSAGE_TAG, teamMessageText } from '../../entries/host-input.ts'
export type { TeamMessagePayload, TeamTaskPayload, TeamTaskStatus } from '../../session-entries/teams.ts'
export {
  MAX_TASK_WRITE_SCOPES,
  MAX_TEAM_TASKS as TEAM_TASKS_MAX,
  normalizeWriteScopes,
  planTaskCreate,
  planTaskUpdate,
  taskViews,
  TeamTaskError,
  teamTasks,
  writeScopeWarnings,
} from './board.ts'
export type {
  NotClaimableReason,
  TaskCreateInput,
  TaskUpdateContext,
  TaskUpdateInput,
  TeamActor,
  TeamTaskErrorCode,
  TeamTaskView,
  TeamWarning,
} from './board.ts'
export {
  MAX_TEAMMATES as TEAMMATES_MAX,
  TEAM_BROADCAST,
  TEAM_LEAD_NAME as TEAM_LEAD,
  TEAM_MESSAGE_BODY_MAX as TEAM_MESSAGE_MAX,
  teammateNameProblem,
} from './names.ts'
export { lastAgentEnds, memberStatus, subagentReachable, teamRoster } from './roster.ts'
export type { RosterMember, TeamMemberStatus as RosterMemberStatus } from './roster.ts'
export { teamSectionText } from './section.ts'
export type { TeamSectionInput } from './section.ts'
export {
  createSendMessageTool,
  createTaskCreateTool,
  createTaskListTool,
  createTaskUpdateTool,
  sendMessageParameters,
  taskCreateParameters,
  taskListParameters,
  taskUpdateParameters,
  teamErrorText,
  TeamMessageError,
} from './tools.ts'
export type { TeamMessageErrorCode, TeamPort, TeamSendRequest, TeamSent, TeamTaskCreateRequest, TeamTaskUpdateRequest } from './tools.ts'
