// Adapted from pi coding-agent 1.4.0 (MIT, Copyright (c) 2025 Mario Zechner). See THIRD_PARTY_NOTICES.md.

import { Type, type Static } from 'typebox'
import { SandboxUnavailableError, type ExecPort } from '../../ports/exec.ts'
import { PtyUnavailableError } from '../../ports/pty.ts'
import {
  escalationHintMarker,
  JUSTIFICATION_DESCRIPTION,
  SANDBOX_PERMISSIONS_DESCRIPTION,
  SANDBOX_TOOL_NOTE,
  sandboxDenialMarker,
  sandboxUnavailableText,
} from '../../policy/sandbox.ts'
import type { SandboxMode } from '../../session-entries/permissions.ts'
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, type TruncationResult } from '../truncate.ts'
import type { BackgroundJobLauncher } from '../../tasks/jobs/tools.ts'
import type { CokoTool, ToolExecutionContext } from '../types.ts'
import { OutputAccumulator, type OutputSnapshot } from './output-accumulator.ts'

const MAX_TIMEOUT_MS = 2_147_483_647
const STRUCTURED_OUTPUT_MAX_BYTES = 1024 * 1024
const UPDATE_THROTTLE_MS = 100

export const bashParameters = Type.Object({
  command: Type.String({ description: 'Shell command to execute' }),
  timeout: Type.Optional(Type.Number({ description: 'Timeout in seconds (optional, no default timeout)' })),
  sandbox_permissions: Type.Optional(
    Type.Union([Type.Literal('workspace-write'), Type.Literal('danger-full-access')], { description: SANDBOX_PERMISSIONS_DESCRIPTION }),
  ),
  justification: Type.Optional(Type.String({ description: JUSTIFICATION_DESCRIPTION })),
  run_in_background: Type.Optional(
    Type.Boolean({
      description:
        'Run the command as a background job and return its job id immediately (for dev servers, watchers and long builds). Read its output with job_output, stop it with job_kill; you are notified when it ends. timeout does not apply.',
    }),
  ),
  tty: Type.Optional(
    Type.Boolean({
      description:
        'Run the background job in a pseudo terminal (120x30) for interactive programs such as REPLs, installers and debuggers; send input with job_input. Requires run_in_background: true.',
    }),
  ),
})

/** 宿主没有 PTY：命令未运行。 */
export const ptyUnavailableText = (reason?: string) =>
  `pty-unavailable: the command was not run because no pseudo terminal is available on this host${reason ? ` (${reason})` : ''}. Run it without tty, non-interactively.`

/**
 * bash 在宿主提供后台任务时收到的执行上下文：jobs 为本 Session 的后台任务入口（宿主在运行时的工具集上注入）。缺省时
 * run_in_background 以错误结果返回。
 */
export interface BashExecutionContext extends ToolExecutionContext {
  jobs?: BackgroundJobLauncher
}

export const bashOutputSchema = Type.Object({
  output: Type.String({ description: 'Combined stdout and stderr, possibly truncated' }),
  truncated: Type.Boolean(),
  full_output_path: Type.Optional(Type.String({ description: 'Full output, when truncated' })),
  exit_code: Type.Number(),
  wall_time_seconds: Type.Number(),
})

export type BashOutput = Static<typeof bashOutputSchema>

export interface BashToolDetails {
  truncation?: TruncationResult
  fullOutputPath?: string
  /** Present when the sandbox denied a file effect of the command. */
  sandbox?: { mode: SandboxMode; denied: true }
}

export interface BashToolOptions {
  cwd: string
  exec: ExecPort
  /** Directory for full-output spill files; default the OS temp directory. */
  tempDir?: string
}

function resolveTimeoutMs(timeout: number | undefined): number | undefined {
  if (timeout === undefined) return undefined
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('Invalid timeout: must be a finite number of seconds')
  const timeoutMs = timeout * 1000
  if (timeoutMs > MAX_TIMEOUT_MS) throw new Error(`Invalid timeout: maximum is ${MAX_TIMEOUT_MS / 1000} seconds`)
  return timeoutMs
}

const appendStatus = (text: string, status: string) => `${text ? `${text}\n\n` : ''}${status}`

export function createBashTool({ cwd, exec, tempDir }: BashToolOptions): CokoTool<typeof bashParameters, BashToolDetails | undefined> {
  return {
    name: 'bash',
    label: 'bash',
    description: `Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a file. Optionally provide a timeout in seconds. ${SANDBOX_TOOL_NOTE}`,
    parameters: bashParameters,
    effect: 'side-effect',
    permissionSubject: (args) => args.command,
    sandboxRequest: ({ sandbox_permissions, justification }) =>
      sandbox_permissions === undefined && justification === undefined
        ? undefined
        : { ...(sandbox_permissions === undefined ? {} : { mode: sandbox_permissions }), ...(justification === undefined ? {} : { justification }) },
    outputSchema: bashOutputSchema,
    // bash has its own `timeout` argument; the unified default would cut long builds short.
    timeoutMs: 0,
    async execute(toolCallId, { command, timeout, run_in_background, tty }, signal, onUpdate, context) {
      const sandbox = context?.sandbox
      if (tty && !run_in_background) throw new Error('Invalid arguments: tty requires run_in_background: true')
      if (run_in_background) {
        const jobs = (context as BashExecutionContext | undefined)?.jobs
        if (!jobs || !exec.spawn) throw new Error('Background jobs are not available on this host')
        const spawn = exec.spawn.bind(exec)
        try {
          const { jobId, label } = await jobs.start({ toolCallId, command, cwd, ...(sandbox ? { sandbox } : {}), ...(tty ? { tty } : {}), spawn })
          const read = tty ? 'Send input with job_input; read output with job_output.' : 'Read output with job_output.'
          return { content: [{ type: 'text', text: `Started background job ${jobId}: ${label}. ${read}` }], details: undefined }
        } catch (error) {
          if (error instanceof SandboxUnavailableError) throw new Error(sandboxUnavailableText(error.mode, error.message), { cause: error })
          if (error instanceof PtyUnavailableError) throw new Error(ptyUnavailableText(), { cause: error })
          throw error
        }
      }
      const timeoutMs = resolveTimeoutMs(timeout)
      const output = new OutputAccumulator(tempDir, 'coko-bash', context?.outputFile, context?.outputRedaction?.stream())
      let accepting = true
      let timer: NodeJS.Timeout | undefined
      let dirty = false
      let lastUpdateAt = 0

      const emitUpdate = () => {
        if (!onUpdate || !dirty) return
        dirty = false
        lastUpdateAt = Date.now()
        const snapshot = output.snapshot()
        onUpdate({
          content: [{ type: 'text', text: snapshot.content }],
          details: snapshot.truncation.truncated
            ? { truncation: snapshot.truncation, ...(snapshot.fullOutputPath ? { fullOutputPath: snapshot.fullOutputPath } : {}) }
            : undefined,
        })
      }
      const scheduleUpdate = () => {
        if (!onUpdate) return
        dirty = true
        const delay = UPDATE_THROTTLE_MS - (Date.now() - lastUpdateAt)
        if (delay <= 0) {
          if (timer) clearTimeout(timer)
          timer = undefined
          emitUpdate()
          return
        }
        timer ??= setTimeout(() => {
          timer = undefined
          emitUpdate()
        }, delay)
      }
      const finishOutput = async (): Promise<OutputSnapshot> => {
        accepting = false
        output.finish()
        if (timer) clearTimeout(timer)
        timer = undefined
        emitUpdate()
        const snapshot = output.snapshot()
        await output.closeTempFile()
        return snapshot
      }
      const format = (snapshot: OutputSnapshot, emptyText: string) => {
        const { truncation } = snapshot
        let text = snapshot.content || emptyText
        let details: BashToolDetails | undefined
        if (truncation.truncated) {
          details = { truncation, ...(snapshot.fullOutputPath ? { fullOutputPath: snapshot.fullOutputPath } : {}) }
          const startLine = truncation.totalLines - truncation.outputLines + 1
          const endLine = truncation.totalLines
          if (truncation.lastLinePartial) {
            text += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${formatSize(output.lastLineBytes())}). Full output: ${snapshot.fullOutputPath}]`
          } else if (truncation.truncatedBy === 'lines') {
            text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${snapshot.fullOutputPath}]`
          } else {
            text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Full output: ${snapshot.fullOutputPath}]`
          }
        }
        if (snapshot.storedOutputTruncated) text += '\n[truncated]'
        return { text, details }
      }

      const startedAt = performance.now()
      try {
        let outcome
        try {
          outcome = await exec.exec({
            command,
            cwd,
            onData: (chunk) => {
              if (!accepting) return
              output.append(chunk)
              scheduleUpdate()
            },
            ...(signal ? { signal } : {}),
            ...(timeoutMs === undefined ? {} : { timeoutMs }),
            ...(sandbox ? { sandbox } : {}),
          })
        } catch (error) {
          if (error instanceof SandboxUnavailableError) throw new Error(sandboxUnavailableText(error.mode, error.message), { cause: error })
          throw error
        }
        const snapshot = await finishOutput()
        if (outcome.kind === 'aborted') throw new Error(appendStatus(format(snapshot, '').text, 'Command aborted'))
        if (outcome.kind === 'timeout') throw new Error(appendStatus(format(snapshot, '').text, `Command timed out after ${timeout} seconds`))

        const formatted = format(snapshot, '(no output)')
        const text = formatted.text
        let details = formatted.details
        const full = await output.readFullOutput(STRUCTURED_OUTPUT_MAX_BYTES)
        const structuredContent: BashOutput = {
          output: full.content,
          truncated: full.truncated,
          ...(full.truncated && snapshot.fullOutputPath ? { full_output_path: snapshot.fullOutputPath } : {}),
          exit_code: outcome.exitCode,
          wall_time_seconds: Math.round((performance.now() - startedAt) / 100) / 10,
        }
        if (outcome.exitCode !== 0) {
          const status = [`Command exited with code ${outcome.exitCode}`]
          if (outcome.sandboxDenied && sandbox) {
            // 拒绝标记与提权提示在退出码之前（DSH 的顺序）。
            status.unshift(sandboxDenialMarker(sandbox.mode), ...(sandbox.mode === 'danger-full-access' ? [] : [escalationHintMarker()]))
            details = { ...details, sandbox: { mode: sandbox.mode, denied: true } }
          }
          return {
            content: [{ type: 'text', text: appendStatus(text, status.join('\n')) }],
            details,
            structuredContent,
            isError: true,
          }
        }
        return { content: [{ type: 'text', text }], details, structuredContent }
      } finally {
        if (timer) clearTimeout(timer)
        if (accepting) {
          output.finish()
          await output.closeTempFile()
        }
      }
    },
  }
}
