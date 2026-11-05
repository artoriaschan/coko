// 评测运行器（docs/subsystems/tracing.md#评测）：复用集成测试的 sidecar-harness 启动真实 Sidecar，把用例的 workspace/ 复制到临时目录、
// 提交 prompt、等 Run 结束（read-only / default 下的审批带反馈拒绝，Run 继续），再按文件结果判定；tokens、cost 与 durationMs 来自
// GET …/trace。faux 模式用用例的脚本；真实模式（COKO_EVAL_PROVIDER_CONFIG 与对应的 COKO_CREDENTIAL_<ID> 都存在）用真实模型。
import { BASE_PROMPT_V2, DEFAULT_SYSTEM_PROMPT_VERSION } from '@coko/agent'
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { API_ROUTES, apiPaths, permissionPaths, tracePaths, type ProviderFields, type TraceResponse } from '@coko/protocol'
import {
  client,
  connect,
  exchange,
  fauxScript,
  seedProviders,
  sidecarDirs,
  startSidecar,
  tempDir,
  type ApprovalRequestEntry,
} from '../integration/sidecar-harness.ts'
import type { EvalCase } from './case.ts'
import { judge } from './judge.ts'

/** 真实模式的配置文件（COKO_EVAL_PROVIDER_CONFIG）：一个 Provider（与设置中保存的字段相同，不含密钥）与要用的模型 id。 */
export interface EvalProviderConfig {
  provider: ProviderFields
  model: string
}

export type EvalMode = { kind: 'faux' } | { kind: 'real'; config: EvalProviderConfig; credential: string }

export interface EvalResult {
  name: string
  mode: 'faux' | 'real'
  basePromptVersion: string
  pass: boolean
  reasons: string[]
  tokens: number
  cost: number
  durationMs: number
  toolCalls: number
  status?: string
}

/** 凭据的环境变量名（与 Sidecar 的 credentialEnvName 相同）。 */
export const credentialEnvName = (providerId: string) => `COKO_CREDENTIAL_${providerId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`

/** 真实模式的配置；配置文件或凭据缺一时为 undefined（报告写 skipped: no-credentials）。 */
export async function realMode(env: NodeJS.ProcessEnv = process.env): Promise<EvalMode | undefined> {
  const path = env.COKO_EVAL_PROVIDER_CONFIG
  if (!path) return undefined
  const config = JSON.parse(await readFile(path, 'utf8')) as EvalProviderConfig
  const credential = env[credentialEnvName(config.provider.id)]
  return credential ? { kind: 'real', config, credential } : undefined
}

/** 目录下全部文件的内容（相对路径 → 文本）。 */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  const files = entries.filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name))
  return Object.fromEntries(await Promise.all(files.map(async (path) => [relative(dir, path), await readFile(path, 'utf8')] as const)))
}

const DENY_FEEDBACK = 'This evaluation runs without a human: the request was denied. Continue without it.'

/** Explicit candidate selection is limited to the Sidecar test hook; it never changes the runtime default. */
export interface EvalRunOptions {
  basePrompt?: 'v2'
}

export async function runCase(caseDir: string, spec: EvalCase, mode: EvalMode, options: EvalRunOptions = {}): Promise<EvalResult> {
  const root = await tempDir('coko-eval-')
  const workspace = join(root, 'workspace')
  await cp(join(caseDir, 'workspace'), workspace, { recursive: true })
  const initial = await snapshot(workspace)
  const dirs = await sidecarDirs()
  const env: Record<string, string> = options.basePrompt ? { COKO_TEST_BASE_PROMPT: options.basePrompt } : {}
  if (mode.kind === 'faux') {
    // 有价格：报告中的 cost 按 pi-ai 的算法给出（与真实 Provider 相同）。
    env.COKO_FAUX_SCRIPT = await fauxScript(root, { responses: spec.faux, price: { input: 1, output: 2 } }, '.faux.json')
  } else {
    await seedProviders(dirs, [mode.config.provider])
    env[credentialEnvName(mode.config.provider.id)] = mode.credential
  }
  const sidecar = await startSidecar({ dirs, env, ipc: mode.kind === 'faux' })
  try {
    const cookie = await exchange(sidecar)
    const api = client(sidecar, cookie)
    const stream = await connect(sidecar, cookie)
    const workspaceId = (await api.post(API_ROUTES.workspaces, { path: workspace })).body.id as string
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    if (mode.kind === 'real') {
      const set = await api.put(apiPaths.sessionModel(sessionId), { model: { providerId: mode.config.provider.id, modelId: mode.config.model } })
      if (set.status !== 200) throw new Error(`setting the model failed: ${set.status} ${JSON.stringify(set.body)}`)
    }
    const permission = await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: spec.permissionMode ?? 'full-access' })
    if (permission.status !== 200) throw new Error(`setting the permission mode failed: ${permission.status}`)
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
    // 无人值守：每个审批请求带反馈拒绝（Run 继续，模型看到拒绝）。
    const answered = new Set<string>()
    const denyLoop = setInterval(() => {
      for (const entry of stream.entries(sessionId)) {
        if (entry.kind !== 'approval_request') continue
        const { requestId } = entry.payload as ApprovalRequestEntry
        if (answered.has(requestId)) continue
        answered.add(requestId)
        void api.post(apiPaths.sessionApproval(sessionId, requestId), { decision: 'deny', feedback: DENY_FEEDBACK })
      }
    }, 25)
    try {
      const submitted = await api.post(apiPaths.sessionMessages(sessionId), { text: spec.prompt })
      if (submitted.status !== 202) throw new Error(`submitting the prompt failed: ${submitted.status}`)
      await stream.waitFor(() => stream.entries(sessionId).some((e) => e.kind === 'run_end'), mode.kind === 'faux' ? 30_000 : 600_000)
    } finally {
      clearInterval(denyLoop)
    }
    const trace = (await api.get(tracePaths.trace(sessionId))).body as TraceResponse
    const status = trace.runs.at(-1)?.status
    const reasons = await judge(spec.expect, { dir: workspace, initial, status, toolCalls: trace.totals.toolCalls })
    return {
      name: spec.name,
      mode: mode.kind,
      basePromptVersion: options.basePrompt ? BASE_PROMPT_V2.version : DEFAULT_SYSTEM_PROMPT_VERSION,
      pass: reasons.length === 0,
      reasons,
      tokens: trace.totals.tokens,
      cost: trace.totals.cost,
      durationMs: trace.totals.durationMs,
      toolCalls: trace.totals.toolCalls,
      ...(status === undefined ? {} : { status }),
    }
  } finally {
    await sidecar.stop()
  }
}

export interface PromptGateCase {
  name: string
  baseline: EvalResult[]
  candidate: EvalResult[]
}

export type PromptGateReport =
  | { skipped: 'not-requested' | 'no-credentials' }
  | { baselineVersion: string; candidateVersion: string; repetitions: 3; cases: PromptGateCase[] }

export interface EvalReport {
  startedAt: string
  faux: EvalResult[]
  promptGate: PromptGateReport
  real: { skipped: 'no-credentials' } | { model: string; results: EvalResult[] }
}

/** 写 reports/<ISO 时间>.json（git 忽略），返回路径。 */
export async function writeReport(dir: string, report: EvalReport): Promise<string> {
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${report.startedAt.replaceAll(':', '-')}.json`)
  await writeFile(path, JSON.stringify(report, null, 2) + '\n')
  return path
}
