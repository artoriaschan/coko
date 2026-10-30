/**
 * 后台任务完成通知的开头标签（生成方为 tasks/jobs 的 jobNotificationText）。宿主据此区分 Run 结束时退回的通知与用户的追加指令，
 * renderer 据此把通知文本块从用户气泡中去掉。
 */
export const JOB_NOTIFICATION_TAG = '<job-notification>'
