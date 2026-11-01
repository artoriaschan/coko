// 无界面运行的审批（ADR 0019）：没有人能回答，需要审批的调用在 PermissionRequest Hook 之后立即拒绝，模型看到这段文本。
// 它是工具结果（toolResult 的错误文本），不是 user message：不经过宿主输入的识别（runAuthority、Goal 的用户输入判断、时间线的包装去除）。

/** 模型看到的拒绝文本（契约）；approval_decision 另记 by: headless。 */
export const HEADLESS_DENIED_TEXT = 'Denied: no approver in a headless run. Rerun with a wider --permission-mode or add an allow rule.'

/** --on-approval fail 停止 Run 时 run_end.error 的 code。 */
export const APPROVAL_DENIED_CODE = 'approval_denied'

/** --on-approval：deny（缺省，Run 继续）或 fail（拒绝后停止 Run，进程以 3 退出）。 */
export type OnApproval = 'deny' | 'fail'
