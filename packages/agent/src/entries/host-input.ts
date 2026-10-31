/**
 * 宿主生成、放进 user message 的文本块的开头标签（唯一来源）。宿主据此区分宿主通知与用户的追加指令（授权与 Goal 推进），
 * renderer 据此把这些文本块从用户气泡中去掉。生成方：jobNotificationText（tasks/jobs）、agentNotificationText（agents/tools）、
 * hookContextText（UserPromptSubmit 与 SubagentStart 的 additionalContext）、scheduledTaskText（tasks/schedules）、teamMessageText（本文件，
 * 团队消息的送达，ADR 0018）。
 */
export const JOB_NOTIFICATION_TAG = '<job-notification>'
/** 后台子代理结束通知的开头（其后是属性）。 */
export const AGENT_NOTIFICATION_TAG = '<agent-notification'
export const HOOK_CONTEXT_TAG = '<hook-context>'
/** 定时任务 Run 的输入的开头（其后是属性）。 */
export const SCHEDULED_TASK_TAG = '<scheduled_task'

/** 团队消息（teammate、lead 或子代理之间）的开头（其后是属性）。 */
export const TEAM_MESSAGE_TAG = '<team-message'

/** 前置在送达通知的 user message 之前的条目 kind：这样的 user message 是宿主通知，不是用户写的。 */
export const HOST_NOTIFICATION_KINDS: ReadonlySet<string> = new Set(['job_notification', 'agent_notification', 'team_message'])

/** 文本是否为宿主通知（Job 或后台子代理的结束通知、团队消息）。 */
export const isHostNotificationText = (text: string) =>
  text.startsWith(JOB_NOTIFICATION_TAG) || text.startsWith(AGENT_NOTIFICATION_TAG) || text.startsWith(TEAM_MESSAGE_TAG)

const escapeAttribute = (value: string) => value.replace(/[&"<>']/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;', "'": '&#39;' })[c]!)

/** 送达团队消息的 user message 文本（前一条为 team_message 条目）；属性值经 XML 转义，正文原样。 */
export const teamMessageText = ({ from, messageId, body }: { from: string; messageId: string; body: string }) =>
  `${TEAM_MESSAGE_TAG} from="${escapeAttribute(from)}" message-id="${escapeAttribute(messageId)}">\n${body}\n</team-message>`

/** 文本是否为宿主生成的文本块（通知或 Hook 追加的上下文）：不显示为用户的输入。 */
export const isHostBlockText = (text: string) => isHostNotificationText(text) || text.startsWith(HOOK_CONTEXT_TAG)

/** Hook 的 additionalContext 在 user message 中的文本块（排在输入之后）。 */
export const hookContextText = (context: string) => `${HOOK_CONTEXT_TAG}\n${context}\n</hook-context>`
