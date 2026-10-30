import { Type, type Static } from 'typebox'

/** HTTP 与 WebSocket 共用的错误码。 */
export const ErrorCode = Type.Union([
  Type.Literal('bad-request'),
  Type.Literal('unauthorized'),
  Type.Literal('forbidden'),
  Type.Literal('not-found'),
  /** Session 已有 Run 在进行。 */
  Type.Literal('run-in-progress'),
  /** 上一轮没有以模型错误结束，没有可重试的内容。 */
  Type.Literal('nothing-to-retry'),
  /** Session 没有可用模型（未配置 Provider 或模型不存在）。 */
  Type.Literal('model-not-configured'),
  /** Session 的模型字段为空（例如其 Provider 已被删除）：运行前需要重新选择模型。 */
  Type.Literal('model-required'),
  /** 没有进行中的 Run（追加指令、暂停）。 */
  Type.Literal('no-active-run'),
  /** 上一 Run 不是 paused 或 interrupted，没有可继续的内容。 */
  Type.Literal('nothing-to-continue'),
  /** Run 进行中或等待审批：不能回退或分叉。 */
  Type.Literal('session-busy'),
  /** 有未回答的结果确认（恢复时结果不明的调用）。 */
  Type.Literal('confirmation-pending'),
  /** 启动恢复没能处理该 Session 中被中断的 Run：在恢复成功之前不能开始 Run、回退或分叉。 */
  Type.Literal('recovery-failed'),
  /** 审批请求不在等待中（已回答、已取消或不存在）。 */
  Type.Literal('approval-not-pending'),
  /** 要创建的对象的 ID 已被使用（例如 Provider ID）。 */
  Type.Literal('already-exists'),
  /** 设置的 expectedRevision 与当前 revision 不一致。 */
  Type.Literal('revision-conflict'),
  /** 当前阶段不允许该动作（例如恢复一个运行中的 Goal）。 */
  Type.Literal('invalid-transition'),
  /** 后台任务已经结束，不能停止。 */
  Type.Literal('job-not-running'),
  /** Hook 阻止了提交或手动压缩（details.reason ≤ 2 KB）。 */
  Type.Literal('hook-blocked'),
  /** 子 Session 不接受用户提交或交接。 */
  Type.Literal('child-session'),
  /** 子代理已经结束，不能停止。 */
  Type.Literal('agent-not-running'),
  /** 定时任务的 Run 与子 Session 中不能创建或修改定时任务。 */
  Type.Literal('schedule-not-allowed'),
  /** Workspace 不在 git 仓库中。 */
  Type.Literal('not-a-git-repo'),
  /** worktree 名不合规则。 */
  Type.Literal('invalid-name'),
  /** worktree 目录或其祖先是符号链接，或真实路径不在仓库根下。 */
  Type.Literal('unsafe-worktree-path'),
  /** 同名分支或路径已存在。 */
  Type.Literal('worktree-exists'),
  /** 绑定的会话有 Run、子代理、Job 或定时任务在进行（details.reasons）。 */
  Type.Literal('worktree-busy'),
  /** worktree 有未提交的改动（details.files）。 */
  Type.Literal('worktree-dirty'),
  /** 会话绑定的 worktree 已被移除。 */
  Type.Literal('worktree-removed'),
  /** 会话没有用户消息，没有可交接的内容。 */
  Type.Literal('nothing-to-hand-off'),
  /** 要批准的 digest 不在当前项目文件中。 */
  Type.Literal('digest-mismatch'),
  /** 存储不可继续使用（租约丢失、状态未知等）。 */
  Type.Literal('storage-unavailable'),
  Type.Literal('internal'),
])
export type ErrorCode = Static<typeof ErrorCode>

export const ErrorResponse = Type.Object(
  {
    error: Type.Object({
      code: ErrorCode,
      message: Type.String(),
      details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    }),
  },
  { additionalProperties: false },
)
export type ErrorResponse = Static<typeof ErrorResponse>
