export type StoreErrorCode =
  /** 引用的 Workspace、Session 或 Provider 不存在。 */
  | 'not-found'
  /** 设置的 expectedRevision 与当前 revision 不一致。 */
  | 'revision-conflict'
  /** 条目的 kind 未注册、版本未登记或 payload 不合 schema；整批未提交。 */
  | 'invalid-payload'
  /** 仓库方法的参数不合约束（例如 Memory 的作用域与 workspaceId 不一致）。 */
  | 'invalid-input'
  /** 存储已关闭。 */
  | 'closed'
  /** 另一实例持有宿主租约（打开时，fatal）。 */
  | 'lease-held'
  /** 租约已被其他实例接管，本实例不能再写（运行中，fatal）。 */
  | 'lease-lost'
  /** 完整性检查失败，原文件已隔离（fatal）。 */
  | 'corrupt'
  /** 库版本高于程序支持的版本（fatal）。 */
  | 'version-too-new'
  /** 迁移步骤失败；已提交的步骤保留，备份路径在 details（fatal）。 */
  | 'migration-failed'
  /** 打开库失败（权限、I/O 等，fatal）。 */
  | 'open-failed'
  /** 事务回滚失败，连接状态未知，必须关闭重开（fatal）。 */
  | 'unknown-state'
  /** 其他存储错误（例如磁盘已满），事务已回滚；原错误在 cause。 */
  | 'storage-failed'

const FATAL: ReadonlySet<StoreErrorCode> = new Set([
  'lease-held',
  'lease-lost',
  'corrupt',
  'version-too-new',
  'migration-failed',
  'open-failed',
  'unknown-state',
])

/** session 包的所有失败都以 StoreError 报告；fatal 为 true 时存储不可继续使用，需由宿主提示用户。 */
export class StoreError extends Error {
  override readonly name = 'StoreError'
  readonly code: StoreErrorCode
  readonly fatal: boolean
  readonly details: Readonly<Record<string, unknown>>

  constructor(code: StoreErrorCode, message: string, details: Record<string, unknown> = {}, options?: { cause?: unknown }) {
    super(message, options)
    this.code = code
    this.fatal = FATAL.has(code)
    this.details = details
  }
}

export function isStoreError(error: unknown, code?: StoreErrorCode): error is StoreError {
  return error instanceof StoreError && (code === undefined || error.code === code)
}
