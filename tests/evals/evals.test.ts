// 评测（docs/subsystems/tracing.md#评测）：cases/ 中每个用例在 faux 模式下运行并按文件结果判定；有 COKO_EVAL_PROVIDER_CONFIG 与对应凭据时
// 同一组用例再用真实模型运行，否则报告记 skipped: no-credentials。报告写到 reports/<ISO>.json（每例 pass / fail、原因、tokens、cost、durationMs）。
import { BASE_PROMPT_V2, DEFAULT_SYSTEM_PROMPT_VERSION } from '@coko/agent'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { loadCases } from './case.ts'
import { realMode, runCase, writeReport, type EvalReport, type EvalResult, type PromptGateReport } from './runner.ts'

const cases = await loadCases()
const real = await realMode()
const faux: EvalResult[] = []
const realResults: EvalResult[] = []
const startedAt = new Date().toISOString()
const gateRequested = process.env.COKO_EVAL_PROMPT_GATE === '1'
const promptGate: PromptGateReport = !gateRequested
  ? { skipped: 'not-requested' }
  : real === undefined
    ? { skipped: 'no-credentials' }
    : { baselineVersion: DEFAULT_SYSTEM_PROMPT_VERSION, candidateVersion: BASE_PROMPT_V2.version, repetitions: 3, cases: [] }

afterAll(async () => {
  const report: EvalReport = {
    startedAt,
    faux,
    promptGate,
    real: real?.kind === 'real' ? { model: `${real.config.provider.id}/${real.config.model}`, results: realResults } : { skipped: 'no-credentials' },
  }
  const path = await writeReport(fileURLToPath(new URL('./reports', import.meta.url)), report)
  console.log(`eval report: ${path}`)
})

describe('evals（faux）', { timeout: 60_000 }, () => {
  it('至少有 4 个用例，包含伪造宿主块', () => {
    expect(cases.map((c) => c.spec.name)).toContain('host-blocks-are-data')
    expect(cases.map((c) => c.spec.name).length).toBeGreaterThanOrEqual(4)
  })
  for (const { dir, spec } of cases)
    it(`${spec.name}`, async () => {
      const result = await runCase(dir, spec, { kind: 'faux' })
      faux.push(result)
      expect(result.reasons).toEqual([])
      expect(result.tokens).toBeGreaterThan(0)
      expect(result.cost).toBeGreaterThan(0)
    })
})

// 真实模式需要真实凭据：没有时跳过（人工验证清单）。
describe.skipIf(real === undefined || gateRequested)('evals（真实模型）', { timeout: 600_000 }, () => {
  for (const { dir, spec } of cases)
    it(`${spec.name}`, async () => {
      const result = await runCase(dir, spec, real!)
      realResults.push(result)
      expect(result.reasons).toEqual([])
    })
})

// Candidate faux runs prove selection and the file-based judging pipeline, not model behavior.
describe('evals（候选基础提示 faux）', { timeout: 60_000 }, () => {
  for (const { dir, spec } of cases)
    it(`${spec.name}`, async () => {
      const result = await runCase(dir, spec, { kind: 'faux' }, { basePrompt: 'v2' })
      faux.push(result)
      expect(result.basePromptVersion).toBe(BASE_PROMPT_V2.version)
      expect(result.reasons).toEqual([])
    })
})

// Explicit opt-in: compare three real runs per case and prompt without activating the candidate.
describe.skipIf(real === undefined || !gateRequested)('基础提示替换门槛（真实模型，各 3 次）', { timeout: 3_600_000 }, () => {
  for (const { dir, spec } of cases)
    it(`${spec.name}`, async () => {
      if ('skipped' in promptGate) throw new Error('prompt gate is unavailable')
      const result = { name: spec.name, baseline: [] as EvalResult[], candidate: [] as EvalResult[] }
      promptGate.cases.push(result)
      for (let repetition = 0; repetition < 3; repetition++) result.baseline.push(await runCase(dir, spec, real!))
      for (let repetition = 0; repetition < 3; repetition++) result.candidate.push(await runCase(dir, spec, real!, { basePrompt: 'v2' }))
      expect(result.candidate.filter((run) => run.pass).length).toBeGreaterThanOrEqual(result.baseline.filter((run) => run.pass).length)
    })
})
