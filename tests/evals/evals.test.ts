// 评测（docs/subsystems/tracing.md#评测）：cases/ 中每个用例在 faux 模式下运行并按文件结果判定；有 COKO_EVAL_PROVIDER_CONFIG 与对应凭据时
// 同一组用例再用真实模型运行，否则报告记 skipped: no-credentials。报告写到 reports/<ISO>.json（每例 pass / fail、原因、tokens、cost、durationMs）。
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { loadCases } from './case.ts'
import { realMode, runCase, writeReport, type EvalReport, type EvalResult } from './runner.ts'

const cases = await loadCases()
const real = await realMode()
const faux: EvalResult[] = []
const realResults: EvalResult[] = []
const startedAt = new Date().toISOString()

afterAll(async () => {
  const report: EvalReport = {
    startedAt,
    faux,
    real: real?.kind === 'real' ? { model: `${real.config.provider.id}/${real.config.model}`, results: realResults } : { skipped: 'no-credentials' },
  }
  const path = await writeReport(fileURLToPath(new URL('./reports', import.meta.url)), report)
  console.log(`eval report: ${path}`)
})

describe('evals（faux）', { timeout: 60_000 }, () => {
  it('至少有 3 个用例', () => {
    expect(cases.map((c) => c.spec.name).length).toBeGreaterThanOrEqual(3)
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
describe.skipIf(real === undefined)('evals（真实模型）', { timeout: 600_000 }, () => {
  for (const { dir, spec } of cases)
    it(`${spec.name}`, async () => {
      const result = await runCase(dir, spec, real!)
      realResults.push(result)
      expect(result.reasons).toEqual([])
    })
})
