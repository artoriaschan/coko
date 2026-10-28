// 命令沙箱的档位与提权阶梯（ADR 0005）。模式决定 Sandbox Mode；被沙箱拒绝的命令只能以严格更宽的档位重试一次，
// 每次都经用户批准（kind=escalation 的 Approval Request）。拒绝标记与提权提示是模型可见契约，文本沿用 DSH packages/sandbox。
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type { SandboxPolicy } from '../ports/exec.ts'
import type { PermissionMode, SandboxMode } from '../session-entries/index.ts'

const SANDBOX_MODE: Record<PermissionMode, SandboxMode> = {
  'read-only': 'read-only',
  default: 'workspace-write',
  'accept-edits': 'workspace-write',
  'full-access': 'danger-full-access',
}

/** Permission Mode 对应的命令沙箱档位。 */
export function sandboxModeFor(mode: PermissionMode): SandboxMode {
  return SANDBOX_MODE[mode]
}

const RANK: Record<SandboxMode, number> = { 'read-only': 0, 'workspace-write': 1, 'danger-full-access': 2 }
const isSandboxMode = (value: string): value is SandboxMode => Object.hasOwn(RANK, value)

/** a 是否严格比 b 宽。 */
export const isWiderSandbox = (a: SandboxMode, b: SandboxMode) => RANK[a] > RANK[b]
/** 两个档位中较宽的一个。 */
export const widerSandbox = (a: SandboxMode, b: SandboxMode): SandboxMode => (isWiderSandbox(a, b) ? a : b)

/** 系统临时目录的真实路径（macOS 上 /tmp 与 os.tmpdir() 都是 /private 下的链接）。 */
async function tempRoots(): Promise<string[]> {
  const roots = await Promise.all([tmpdir(), '/tmp'].map((dir) => realpath(dir).catch(() => undefined)))
  return [...new Set(roots.filter((root): root is string => root !== undefined))]
}

/**
 * 档位的可写根（真实路径），文件工具的写入边界与 Seatbelt profile 共用这一处推导：read-only 没有；workspace-write 为
 * Workspace、`/tmp` 与 `os.tmpdir()`（与 DSH 的默认集合相同，不含 ~/.npm、~/.cache 等用户目录）；danger-full-access 为根目录。
 */
export async function writableRootsForSandbox(mode: SandboxMode, workspace: string): Promise<string[]> {
  if (mode === 'read-only') return []
  if (mode === 'danger-full-access') return ['/']
  return [...new Set([workspace, ...(await tempRoots())])]
}

/** 一次命令执行的沙箱策略。 */
export async function sandboxPolicyFor(mode: SandboxMode, workspace: string): Promise<SandboxPolicy> {
  return { mode, writableRoots: await writableRootsForSandbox(mode, workspace) }
}

/** 工具参数中的提权请求（bash 的 sandbox_permissions 与 justification）。 */
export interface EscalationArgs {
  mode?: string
  justification?: string
}

export type EscalationCheck =
  /** 不提权：没有参数，或目标档位等于当前档位。 */
  | { kind: 'none' }
  | { kind: 'escalate'; targetMode: SandboxMode; justification: string }
  /** 参数错误：调用不执行，也不询问。 */
  | { kind: 'invalid'; message: string }

/**
 * 校验提权参数（grilling B2）：档位与理由成对；等于当前档位视为不提权；只能严格更宽，更窄或未知档位报错。
 * 只有空白的理由视为未提供。
 */
export function checkEscalation(args: EscalationArgs, current: SandboxMode): EscalationCheck {
  const justification = args.justification !== undefined && args.justification.trim() !== '' ? args.justification : undefined
  const mode = args.mode
  if (mode === undefined) {
    return justification === undefined
      ? { kind: 'none' }
      : { kind: 'invalid', message: 'invalid escalation: justification is only valid together with sandbox_permissions' }
  }
  if (mode === current) return { kind: 'none' }
  if (!isSandboxMode(mode) || !isWiderSandbox(mode, current)) {
    return { kind: 'invalid', message: `invalid escalation: sandbox escalation to "${mode}" is not strictly wider than this call's current "${current}" mode` }
  }
  if (justification === undefined) return { kind: 'invalid', message: 'invalid escalation: sandbox_permissions requires a justification' }
  return { kind: 'escalate', targetMode: mode, justification }
}

/** 模型可见的拒绝标记（沿用 DSH）。 */
export function sandboxDenialMarker(mode: SandboxMode): string {
  return `[sandbox: file access denied under ${mode} mode]`
}

/** 随拒绝标记出现的提权提示（沿用 DSH）。 */
export function escalationHintMarker(): string {
  return '[sandbox: escalation available — retry this exact command once with sandbox_permissions (the narrowest wider mode that suffices) + justification; the approval prompt asks the user]'
}

/** 用户拒绝提权时交给模型的文本（沿用 DSH）。 */
export function escalationRejectedText(mode: SandboxMode): string {
  return `The user rejected escalating this command to "${mode}"; it stays denied, so stop and explain instead of working around it.`
}

/** 受限档位而宿主无法启用沙箱：命令不运行（fail-closed）。 */
export function sandboxUnavailableText(mode: SandboxMode, reason?: string): string {
  return `sandbox-unavailable: the command was not run because the ${mode} sandbox is not available on this host${reason ? ` (${reason})` : ''}. Ask the user to switch to Full access if the command must run without a sandbox.`
}

/** bash 的 sandbox_permissions 参数说明（沿用 DSH）。 */
export const SANDBOX_PERMISSIONS_DESCRIPTION =
  'The narrowest wider sandbox mode for a one-shot retry of the exact command the sandbox just denied; the retry asks the user for approval.'
export const JUSTIFICATION_DESCRIPTION =
  'Required with sandbox_permissions: one sentence for the user explaining why this exact command needs the wider access. Use the language of the user’s current request.'
/** bash 描述中关于沙箱的一句（沿用 DSH）。 */
export const SANDBOX_TOOL_NOTE =
  'Commands may run under a file sandbox; a blocked file operation is reported as `[sandbox: file access denied under <mode> mode]`, a policy denial: do not retry another way.'
