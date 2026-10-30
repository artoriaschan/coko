// 计划的格式规则有两份：@coko/agent（exit_plan_mode 的参数检查与审批 subject）与 @coko/protocol（审阅接口的 editedPlan 与界面的标题）。
// agent 不依赖 protocol，两份分别维护；这里对同一组输入断言两边结果相等（同 entry-payloads.test.ts 的做法）。
import * as agent from '@coko/agent'
import * as protocol from '@coko/protocol'
import { AnswerApprovalRequest } from '@coko/protocol'
import { Value } from 'typebox/value'
import { describe, expect, it } from 'vitest'

const samples: string[] = [
  '# Plan',
  '## Steps\n\n1. a',
  '   \n\n# Leading blank lines',
  '#\tTab after hash',
  '####### Seven hashes',
  '#NoSpace',
  '# ',
  'Plain text first\n# Heading later',
  '',
  '###### Six',
  '# Title  \nbody',
  '# ' + 'x'.repeat(agent.PLAN_MAX_CHARS - 2),
  '# ' + 'x'.repeat(agent.PLAN_MAX_CHARS - 1),
]

describe('计划规则的两份实现', () => {
  it('字符上限相同', () => {
    expect(protocol.PLAN_MAX_CHARS).toBe(agent.PLAN_MAX_CHARS)
  })

  it('planMarkdownProblem：同一组输入结果相等', () => {
    expect(samples.map((s) => protocol.planMarkdownProblem(s))).toEqual(samples.map((s) => agent.planMarkdownProblem(s)))
  })

  it('planTitle：同一组输入结果相等', () => {
    expect(samples.map((s) => protocol.planTitle(s))).toEqual(samples.map((s) => agent.planTitle(s)))
  })

  it('审阅接口的 editedPlan 上限即 PLAN_MAX_CHARS', () => {
    const allow = (editedPlan: string) => Value.Check(AnswerApprovalRequest, { decision: 'allow', editedPlan })
    expect(allow('x'.repeat(protocol.PLAN_MAX_CHARS))).toBe(true)
    expect(allow('x'.repeat(protocol.PLAN_MAX_CHARS + 1))).toBe(false)
  })
})
