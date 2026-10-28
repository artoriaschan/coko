// macOS Seatbelt 沙箱（ADR 0005）：以 sandbox-exec 包裹 bash，只约束文件写入（不限制网络与读取）。
// profile 与可写根沿用 DSH packages/sandbox/sandbox-local：拒绝全部写入，放行 /dev/null 与可写根（Workspace、/tmp、
// os.tmpdir() 的真实路径，由 @coko/agent 的 writableRootsForSandbox 推导）；不放开 HOME 或 ~/.npm、~/.cache。
// 启动探测失败或可执行文件缺失时受限档位 fail-closed（SandboxUnavailableError），danger-full-access 不包裹。
import { execFile } from 'node:child_process'
import { SandboxUnavailableError, type LocalSandbox, type SandboxPolicy } from '@coko/agent'

/** 系统自带的 sandbox-exec；用绝对路径，不经 PATH 解析。 */
export const DEFAULT_SANDBOX_EXEC = '/usr/bin/sandbox-exec'
/** Seatbelt 拒绝写入时内核给出的错误文本（大小写不敏感匹配）。 */
export const SEATBELT_DENIAL_SIGNATURE = 'operation not permitted'

const sbplString = (path: string) => `"${path.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`

/** 一次执行的 SBPL profile。 */
export function seatbeltProfile(policy: SandboxPolicy): string {
  const forms = ['(version 1)', '(allow default)', '(deny file-write*)', `(allow file-write* (literal ${sbplString('/dev/null')}))`]
  const roots = policy.mode === 'workspace-write' ? policy.writableRoots : []
  if (roots.length > 0) forms.push(`(allow file-write* ${roots.map((root) => `(subpath ${sbplString(root)})`).join(' ')})`)
  return forms.join(' ')
}

export type SeatbeltProbe = { available: true; executable?: string } | { available: false; reason: string; executable?: string }

/**
 * 启动探测：以 read-only profile 运行 `true`，退出码 0 说明内核接受并执行了 profile。可执行文件缺失（非 macOS、
 * 将来 Apple 移除 sandbox-exec）或 profile 被拒绝时为不可用。
 */
export function probeSeatbelt(executable = DEFAULT_SANDBOX_EXEC, timeoutMs = 5_000): Promise<SeatbeltProbe> {
  const tag = executable === DEFAULT_SANDBOX_EXEC ? {} : { executable }
  return new Promise((resolve) => {
    execFile(executable, ['-p', seatbeltProfile({ mode: 'read-only', writableRoots: [] }), '--', '/usr/bin/true'], { timeout: timeoutMs }, (error) => {
      resolve(error ? { available: false, reason: `${executable}: ${error.message}`, ...tag } : { available: true, ...tag })
    })
  })
}

/** 探测结果对应的 LocalSandbox：可用时包裹为 `sandbox-exec -p <profile> --`，否则受限档位以 SandboxUnavailableError 拒绝。 */
export function createSeatbeltSandbox(probe: SeatbeltProbe): LocalSandbox {
  const executable = probe.executable ?? DEFAULT_SANDBOX_EXEC
  return {
    denialSignature: SEATBELT_DENIAL_SIGNATURE,
    wrap(policy) {
      if (!probe.available) throw new SandboxUnavailableError(policy.mode, probe.reason)
      return [executable, '-p', seatbeltProfile(policy), '--']
    },
  }
}
