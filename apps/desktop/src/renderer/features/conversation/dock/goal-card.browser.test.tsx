// Goal 卡、Goal 行、Run 用量行与 Session 费用：在应用中（内存协议后端）由 goal、run_start 与带 usage 的 assistant 条目驱动；
// Goal 的已用量与动作经注入的 GoalBackend（与 GET / POST …/goal 同形）。
import '../../../styles.css'
import { dictionaries } from '@coko/i18n'
import { GOAL_REASON_CODES, type GoalActionRequest, type GoalPayload, type GoalResponse, type GoalUsage, type SessionEntryRecord } from '@coko/protocol'
import { expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../../app/app.tsx'
import { createAppearanceStore } from '../../../app/appearance-store.ts'
import { createConnectionStore } from '../../../app/connection-store.ts'
import { createPreferences } from '../../../app/preferences.ts'
import { createSettingsPageStore } from '../../../app/settings-page-store.ts'
import { ApiError } from '../../../client/api.ts'
import { createGoalStore, type GoalBackend } from '../../../stores/goal-store.ts'
import { catalogModel, customProvider } from '../../../testing/fake-settings.ts'
import { createFixtureChat } from '../../../testing/fixture-chat.ts'
import { budgetLevel, GoalStoreProvider } from './goal-card.tsx'

let seq = 1000
const record = (kind: string, payload: unknown, runId: string | null = null): SessionEntryRecord =>
  ({ sessionId: 's-1', seq: ++seq, kind, payloadVersion: 1, payload, runId, createdAt: seq }) as SessionEntryRecord

const goal = (patch: Partial<GoalPayload> = {}): GoalPayload => ({
  id: 'goal-1',
  revision: 1,
  objective: 'make the tests pass',
  criteria: [
    { id: 'c1', text: 'tests pass' },
    { id: 'c2', text: 'summary given' },
  ],
  budget: { maxRounds: 10 },
  phase: 'running',
  resumedAtRound: 0,
  source: 'model',
  ...patch,
})

/** 内存 GoalBackend：get 返回当前 goal 与 usage；act 记录请求，hold 时挂起直到 release。 */
function fakeGoals(initial: { goal: GoalPayload | null; usage: GoalUsage }) {
  const state = { ...initial }
  const calls: GoalActionRequest[] = []
  const reads = { count: 0 }
  let hold: { resolve: (r: GoalResponse) => void; reject: (e: unknown) => void } | undefined
  let holding = false
  const backend: GoalBackend = {
    get: async () => {
      reads.count++
      return { goal: state.goal, usage: state.usage }
    },
    act: (_sessionId, request) => {
      calls.push(request)
      if (!holding) return Promise.resolve({ goal: state.goal, usage: state.usage })
      return new Promise((resolve, reject) => (hold = { resolve, reject }))
    },
  }
  return {
    state,
    calls,
    reads,
    backend,
    holdNext: () => (holding = true),
    release: (response: GoalResponse) => {
      holding = false
      hold?.resolve(response)
    },
    fail: (error: unknown) => {
      holding = false
      hold?.reject(error)
    },
  }
}

async function open(options: { entries?: SessionEntryRecord[]; usage?: GoalUsage; locale?: 'en' | 'zh'; goals?: ReturnType<typeof fakeGoals> } = {}) {
  const fixture = createFixtureChat()
  const goals = options.goals ?? fakeGoals({ goal: null, usage: options.usage ?? { rounds: 0 } })
  const store = createAppearanceStore({ theme: 'light', locale: options.locale ?? 'en' })
  const preferences = createPreferences({ appearance: store, settings: fixture.settings, onConflict: () => {}, onFailure: () => {} })
  await render(
    <div style={{ width: '100vw', height: '100vh' }}>
      <GoalStoreProvider store={createGoalStore(goals.backend)}>
        <App
          store={store}
          connection={createConnectionStore()}
          chat={fixture.chat}
          settings={fixture.settings}
          preferences={preferences}
          settingsPage={createSettingsPageStore()}
          pickDirectory={async () => null}
        />
      </GoalStoreProvider>
    </div>,
  )
  await expect.poll(() => fixture.chat.getState().conversations['s-1']?.status).toBe('ready')
  const send = (entry: SessionEntryRecord) => {
    if (entry.kind === 'goal') goals.state.goal = entry.payload as GoalPayload
    fixture.sendServer({ type: 'entry', sessionId: 's-1', entry })
  }
  for (const entry of options.entries ?? []) send(entry)
  return { ...fixture, goals, send }
}

const card = () => document.querySelector<HTMLElement>('[data-slot="goal-card"]')
const toggle = async () => {
  await expect.poll(() => card()?.querySelector('[data-action="toggle-goal"]')).not.toBeNull()
  card()!.querySelector<HTMLButtonElement>('[data-action="toggle-goal"]')!.click()
  await expect.poll(() => card()?.querySelector('[data-slot="goal-details"]')).not.toBeNull()
}

const PHASES: readonly { phase: GoalPayload['phase']; reason?: GoalPayload['reason']; en: [string, string | null]; zh: [string, string | null] }[] = [
  { phase: 'running', en: ['Running', null], zh: ['进行中', null] },
  {
    phase: 'waiting-input',
    reason: { code: 'needs-input', message: 'Which database?' },
    en: ['Waiting for you', 'Needs your input'],
    zh: ['等待你的输入', '需要你的输入'],
  },
  {
    phase: 'waiting-external',
    reason: { code: 'waiting-jobs', message: 'Waiting for background jobs job_1' },
    en: ['Waiting for jobs', 'Waiting for background jobs to finish'],
    zh: ['等待后台任务', '等待后台任务结束'],
  },
  {
    phase: 'paused',
    reason: { code: 'restarted', message: 'x' },
    en: ['Paused', 'Coko restarted; resume to continue'],
    zh: ['已暂停', 'Coko 已重启，恢复后继续'],
  },
  {
    phase: 'blocked',
    reason: { code: 'cost-unpriced', message: 'x' },
    en: ['Blocked', 'The current model is Unpriced, so a cost limit cannot be enforced'],
    zh: ['受阻', '当前模型未定价，无法按费用上限运行'],
  },
  { phase: 'failed', reason: { code: 'model_error', message: 'boom' }, en: ['Failed', 'The run failed'], zh: ['失败', '运行出错'] },
  { phase: 'budget-exhausted', reason: { code: 'tokens', message: 'x' }, en: ['Budget used up', 'No tokens left'], zh: ['预算用尽', 'Token 已用尽'] },
  { phase: 'complete', en: ['Complete', null], zh: ['已完成', null] },
  { phase: 'cancelled', reason: { code: 'user-cancelled', message: 'x' }, en: ['Cancelled', 'You cancelled the goal'], zh: ['已取消', '你取消了目标'] },
]

for (const locale of ['en', 'zh'] as const) {
  it(`九个阶段的徽标与原因（${locale}）：卡片收起时一行原因，时间线 Goal 行用同一徽标`, async () => {
    const fixture = await open({ locale })
    let revision = 0
    for (const { phase, reason, ...text } of PHASES) {
      fixture.send(record('goal', goal({ revision: ++revision, phase, ...(reason ? { reason } : {}) })))
      const [badge, why] = text[locale]
      await expect.poll(() => card()?.querySelector('[data-slot="goal-phase"]')?.textContent).toBe(badge)
      expect(card()!.getAttribute('data-phase')).toBe(phase)
      expect(card()!.querySelector('[data-slot="goal-reason"]')?.textContent ?? null).toBe(why)
      const rows = document.querySelectorAll('[data-slot="goal-row"]')
      expect(rows[rows.length - 1]!.querySelector('[data-slot="goal-phase"]')!.textContent).toBe(badge)
    }
    // 第一条快照为"新目标"与目标文本。
    expect(document.querySelector('[data-slot="goal-row"]')!.textContent).toContain(locale === 'en' ? 'New goal' : '新目标')
    expect(document.querySelector('[data-slot="goal-row"]')!.textContent).toContain('make the tests pass')
  })
}

it('reason.code 的每个已知取值在 zh / en 中都有文案（不落到"运行出错"），含交接后源 Goal 的暂停原因 handed-off', () => {
  // handed-off 由服务端在交接完成后暂停源 Goal 时给出；协议的 GOAL_REASON_CODES 收录它之后这里的显式项是重复的。
  const codes = new Set<string>([...GOAL_REASON_CODES, 'handed-off'])
  for (const locale of ['zh', 'en'] as const) {
    const reasons: Record<string, string> = dictionaries[locale].goal.reason
    expect({ locale, missing: [...codes].filter((code) => !(code in reasons)) }).toEqual({ locale, missing: [] })
  }
})

/** 等两帧：同一帧内合并的重读已经发出。 */
const frames = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

it('已用量只在 goal、run_end、compaction 与带 usage 的 assistant 条目到达时重读：20 条无 usage 的消息至多 1 次', async () => {
  const fixture = await open({ entries: [record('goal', goal())] })
  await expect.poll(() => fixture.goals.reads.count).toBeGreaterThan(0)
  await frames()
  const before = fixture.goals.reads.count
  const entries = () => fixture.chat.getState().conversations['s-1']!.entries.length
  for (let i = 0; i < 10; i++) {
    const assistant = { role: 'assistant', content: [{ type: 'toolCall', id: 't' + i, name: 'bash', arguments: {} }], stopReason: 'toolUse', timestamp: 0 }
    const result = { role: 'toolResult', toolCallId: 't' + i, toolName: 'bash', content: [{ type: 'text', text: 'ok' }], isError: false, timestamp: 0 }
    for (const payload of [assistant, result]) {
      const count = entries()
      fixture.send(record('message', payload, 'run-a'))
      await expect.poll(entries).toBe(count + 1)
      await frames()
    }
  }
  expect(fixture.goals.reads.count - before).toBeLessThanOrEqual(1)
  const settled = fixture.goals.reads.count
  fixture.send(record('goal', goal({ revision: 2 })))
  await expect.poll(() => fixture.goals.reads.count).toBe(settled + 1)
})

for (const locale of ['en', 'zh'] as const) {
  it(`未设费用上限的提示（${locale}）：已定价且没有 maxCost 时显示，设了上限或未定价时不显示`, async () => {
    const hint = locale === 'en' ? 'No cost limit' : '未设费用上限'
    const fixture = await open({
      locale,
      usage: { rounds: 1, toolCalls: 0, tokens: 0, cost: 0, durationMs: 0, costUnpriced: false },
      entries: [record('goal', goal())],
    })
    await toggle()
    const text = () => card()!.querySelector('[data-slot="goal-no-cost-limit"]')?.textContent ?? null
    await expect.poll(text).toContain(hint)
    fixture.send(record('goal', goal({ revision: 2, budget: { maxRounds: 10, maxCost: 1 } })))
    await expect.poll(() => card()!.getAttribute('data-revision')).toBe('2')
    await expect.poll(text).toBeNull()
    fixture.goals.state.usage = { rounds: 1, toolCalls: 0, tokens: 0, cost: 0, durationMs: 0, costUnpriced: true }
    fixture.send(record('goal', goal({ revision: 3 })))
    await expect.poll(() => card()!.querySelector('[data-goal-cost]')?.textContent).toBe(locale === 'en' ? 'Unpriced' : '未定价')
    expect(text()).toBeNull()
  })
}

it('阈值：已用 / 上限 ≥ 80% 为 warning，≥ 100% 为 exhausted', () => {
  expect([budgetLevel(0, 10), budgetLevel(7.99, 10), budgetLevel(8, 10), budgetLevel(9.99, 10), budgetLevel(10, 10), budgetLevel(12, 10)]).toEqual([
    'normal',
    'normal',
    'warning',
    'warning',
    'exhausted',
    'exhausted',
  ])
})

it('预算条：每个已设维度 已用 / 上限；≥ 80% 为 warning 色、耗尽为 destructive 色，进度宽度按比例', async () => {
  const usage: GoalUsage = { rounds: 2, toolCalls: 8, tokens: 1200, cost: 0.25, durationMs: 30_000, costUnpriced: false }
  const fixture = await open({
    usage,
    entries: [record('goal', goal({ budget: { maxRounds: 10, maxToolCalls: 10, maxTokens: 1000, maxCost: 1, maxDurationMs: 600_000 } }))],
  })
  fixture.goals.state.usage = usage
  await expect.poll(() => card()?.querySelector('[data-goal-cost]')?.textContent).toBe('$0.25')
  expect(card()!.querySelector('[data-goal-rounds]')!.textContent).toBe('Round 2/10')
  await toggle()
  const level = (id: string) => card()!.querySelector(`[data-budget="${id}"]`)!.getAttribute('data-level')
  const value = (id: string) => card()!.querySelector(`[data-budget="${id}"] [data-budget-value]`)!.textContent
  await expect.poll(() => level('tokens')).toBe('exhausted')
  expect([level('rounds'), level('tool-calls'), level('cost'), level('time')]).toEqual(['normal', 'warning', 'normal', 'normal'])
  expect([value('rounds'), value('tool-calls'), value('tokens'), value('cost'), value('time')]).toEqual([
    '2 / 10',
    '8 / 10',
    '1,200 / 1,000',
    '$0.25 / $1.00',
    '30s / 10m 0s',
  ])
  // 颜色取实际渲染值：与同主题下的语义色一致。
  const probe = (cls: string) => {
    const el = document.createElement('span')
    el.className = cls
    document.body.append(el)
    const color = getComputedStyle(el).backgroundColor
    el.remove()
    return color
  }
  const fill = (id: string) => card()!.querySelector<HTMLElement>(`[data-budget="${id}"] [data-budget-fill]`)!
  expect(getComputedStyle(fill('tool-calls')).backgroundColor).toBe(probe('bg-warning'))
  expect(getComputedStyle(fill('tokens')).backgroundColor).toBe(probe('bg-destructive'))
  expect(getComputedStyle(fill('rounds')).backgroundColor).toBe(probe('bg-primary'))
  const track = fill('rounds').parentElement!.getBoundingClientRect().width
  expect(fill('rounds').getBoundingClientRect().width).toBeCloseTo(track * 0.2, 0)
  expect(fill('tokens').getBoundingClientRect().width).toBeCloseTo(track, 0)
  expect(fill('rounds').parentElement!.getAttribute('role')).toBe('meter')
})

it('未定价：费用显示"未定价"而不是 0，费用条为提示；Goal 卡始终显示轮次与费用', async () => {
  const usage: GoalUsage = { rounds: 1, toolCalls: 0, tokens: 50, cost: 0, durationMs: 1000, costUnpriced: true }
  await open({ usage, entries: [record('goal', goal({ budget: { maxRounds: 5, maxCost: 2 } }))] })
  await expect.poll(() => card()?.querySelector('[data-goal-cost]')?.textContent).toBe('Unpriced')
  expect(card()!.textContent).not.toContain('$0')
  await toggle()
  const cost = card()!.querySelector('[data-budget="cost"]')!
  expect(cost.hasAttribute('data-unpriced')).toBe(true)
  expect(cost.querySelector('[role="meter"]')).toBeNull()
  expect(cost.textContent).toContain('The current model is Unpriced; cost cannot be calculated')
  expect(cost.textContent).toContain('Unpriced / $2.00')
})

it('取消需确认："保留目标"不发请求；确认后 cancel 带 revision，进行中显示"正在停止"，完成后显示清理结果', async () => {
  const fixture = await open({ entries: [record('goal', goal({ revision: 3 }))] })
  await toggle()
  await userEvent.click(page.getByRole('button', { name: 'Cancel goal' }))
  const dialog = page.getByRole('alertdialog', { name: 'Cancel this goal?' })
  await expect.element(dialog).toBeVisible()
  await userEvent.click(dialog.getByRole('button', { name: 'Keep goal' }))
  await expect.poll(() => document.querySelector('[data-slot="goal-cancel-dialog"]')).toBeNull()
  expect(fixture.goals.calls).toEqual([])

  fixture.goals.holdNext()
  await userEvent.click(page.getByRole('button', { name: 'Cancel goal' }))
  await userEvent.click(page.getByRole('alertdialog').getByRole('button', { name: 'Cancel goal' }))
  await expect.element(page.getByRole('alertdialog').getByRole('button', { name: 'Stopping…' })).toBeDisabled()
  expect(fixture.goals.calls).toEqual([{ action: 'cancel', revision: 3 }])
  const cancelled = goal({
    revision: 4,
    phase: 'cancelled',
    reason: { code: 'user-cancelled', message: 'x' },
    cleanup: { runsAborted: 1, jobsKilled: 2, failures: [] },
  })
  fixture.send(record('goal', cancelled))
  fixture.goals.release({ goal: cancelled, usage: { rounds: 1 } })
  await expect.poll(() => document.querySelector('[data-slot="goal-cancel-dialog"]')).toBeNull()
  await expect.poll(() => card()?.querySelector('[data-slot="goal-cleanup"]')?.textContent).toBe('Runs stopped: 1 · background jobs stopped: 2')
  // 终态没有操作按钮，可以关闭。
  expect(card()!.querySelector('[data-action="pause-goal"]')).toBeNull()
  await userEvent.click(page.getByRole('button', { name: 'Close' }))
  await expect.poll(() => card()).toBeNull()
})

it('key：同一 Goal 的新快照不重挂载卡片与成功条件（goalId、criterionId）；新 Goal 换新节点；完成后显示证据', async () => {
  const fixture = await open({ entries: [record('goal', goal())] })
  await toggle()
  await expect.poll(() => card()?.querySelector('[data-criterion="c1"]')).not.toBeNull()
  const before = { card: card()!, c1: card()!.querySelector('[data-criterion="c1"]')! }
  fixture.send(record('goal', goal({ revision: 2, phase: 'paused', reason: { code: 'user-paused', message: 'x' } })))
  await expect.poll(() => card()!.getAttribute('data-revision')).toBe('2')
  expect(card()).toBe(before.card)
  expect(card()!.querySelector('[data-criterion="c1"]')).toBe(before.c1)

  fixture.send(
    record(
      'goal',
      goal({
        revision: 3,
        phase: 'complete',
        completedBy: 'model',
        evidence: [
          { criterionId: 'c1', text: 'vitest exited 0', toolCallIds: ['b1'] },
          { criterionId: 'c2', text: 'summary posted' },
        ],
      }),
    ),
  )
  await expect
    .poll(() => [...card()!.querySelectorAll('[data-slot="goal-evidence"]')].map((e) => e.textContent))
    .toEqual(['Evidence: vitest exited 0', 'Evidence: summary posted'])
  expect(card()!.querySelectorAll('[data-criterion][data-done]')).toHaveLength(2)

  fixture.send(record('goal', goal({ id: 'goal-2', revision: 1, objective: 'second goal' })))
  await expect.poll(() => card()?.getAttribute('data-goal-id')).toBe('goal-2')
  expect(card()).not.toBe(before.card)
})

it('暂停与恢复带当前 revision；budget-exhausted 仍有维度耗尽时恢复不可用，编辑预算后可恢复', async () => {
  const usage: GoalUsage = { rounds: 3, toolCalls: 4, tokens: 0, cost: 0, durationMs: 0, costUnpriced: false }
  const fixture = await open({ usage, entries: [record('goal', goal({ revision: 1, budget: { maxRounds: 10 } }))] })
  await toggle()
  await userEvent.click(page.getByRole('button', { name: 'Pause' }))
  await expect.poll(() => fixture.goals.calls).toEqual([{ action: 'pause', revision: 1 }])

  fixture.send(
    record('goal', goal({ revision: 2, phase: 'budget-exhausted', reason: { code: 'tool-calls', message: 'x' }, budget: { maxRounds: 10, maxToolCalls: 4 } })),
  )
  await expect.element(page.getByRole('button', { name: 'Resume' })).toBeDisabled()
  await expect.element(page.getByText('Raise the used-up budget before resuming')).toBeVisible()

  await userEvent.click(page.getByRole('button', { name: 'Edit' }))
  const dialog = page.getByRole('dialog', { name: 'Edit goal and budget' })
  await expect.element(dialog).toBeVisible()
  const calls = dialog.getByRole('textbox', { name: 'Tool call limit' })
  await expect.element(calls).toHaveValue('4')
  await userEvent.fill(calls, 'abc')
  await userEvent.click(dialog.getByRole('button', { name: 'Save' }))
  await expect.element(dialog.getByText('Enter a whole number above 0')).toBeVisible()
  await userEvent.fill(calls, '8')
  await userEvent.fill(dialog.getByRole('textbox', { name: 'Time limit (minutes)' }), '1.5')
  await userEvent.click(dialog.getByRole('button', { name: 'Save' }))
  await expect
    .poll(() => fixture.goals.calls.at(-1))
    .toEqual({ action: 'edit', revision: 2, budget: { maxRounds: 10, maxToolCalls: 8, maxDurationMs: 90_000 } })
  await expect.poll(() => document.querySelector('[data-slot="goal-edit-dialog"]')).toBeNull()

  fixture.send(
    record('goal', goal({ revision: 3, phase: 'budget-exhausted', reason: { code: 'tool-calls', message: 'x' }, budget: { maxRounds: 10, maxToolCalls: 8 } })),
  )
  await expect.element(page.getByRole('button', { name: 'Resume' })).toBeEnabled()
  await userEvent.click(page.getByRole('button', { name: 'Resume' }))
  await expect.poll(() => fixture.goals.calls.at(-1)).toEqual({ action: 'resume', revision: 3 })
})

it('revision 冲突：提示并重新读取', async () => {
  const fixture = await open({ entries: [record('goal', goal({ revision: 1 }))] })
  await toggle()
  fixture.goals.holdNext()
  await userEvent.click(page.getByRole('button', { name: 'Mark complete' }))
  fixture.goals.fail(new ApiError('revision-conflict', 'stale', 409))
  await expect.element(page.getByText('The goal was updated elsewhere; showing the latest state')).toBeVisible()
})

it('/goal 无参数打开 Goal 卡（没有 Goal 时为空状态），不发送消息；关闭后消失', async () => {
  const fixture = await open()
  let submitted = 0
  const original = fixture.api.submitMessage
  fixture.api.submitMessage = async (...args) => {
    submitted++
    return original(...args)
  }
  const box = page.getByRole('textbox', { name: 'Give Coko a task' })
  await userEvent.click(box)
  await userEvent.keyboard('/goal')
  await expect.poll(() => box.element().textContent).toBe('/goal')
  await userEvent.keyboard('{Escape}')
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => card()?.hasAttribute('data-empty')).toBe(true)
  expect(card()!.textContent).toContain('This session has no goal')
  expect(submitted).toBe(0)
  expect(fixture.chat.getState().conversations['s-1']!.running).toBe(false)
  await userEvent.click(page.getByRole('button', { name: 'Close' }))
  await expect.poll(() => card()).toBeNull()
})

it('助手底栏不显示费用；Session 费用保留定价状态、累计与分项', async () => {
  const usage = (input: number, output: number, total: number) => ({
    input,
    output,
    cacheRead: 10,
    cacheWrite: 0,
    totalTokens: input + output + 10,
    cost: { input: total / 2, output: total / 2, cacheRead: 0, cacheWrite: 0, total },
  })
  const fixture = await open({
    entries: [
      record('run_start', { trigger: 'submit' }, 'run-a'),
      record(
        'message',
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'a' }],
          stopReason: 'stop',
          timestamp: 0,
          provider: 'p1',
          model: 'faux-1',
          usage: usage(100, 20, 0),
        },
        'run-a',
      ),
      record('run_end', { status: 'completed' }, 'run-a'),
    ],
  })
  // 已定价的模型：目录中写了价格。
  fixture.backend.seedProvider(customProvider('p2', [], { models: [catalogModel('priced-1', { price: { input: 1, output: 2 } })] }))
  await fixture.settings.getState().load()
  fixture.send(record('run_start', { trigger: 'submit' }, 'run-b'))
  fixture.send(
    record(
      'message',
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'b' }],
        stopReason: 'stop',
        timestamp: 0,
        provider: 'p2',
        model: 'priced-1',
        usage: usage(1000, 200, 0.0124),
      },
      'run-b',
    ),
  )
  fixture.send(record('run_end', { status: 'completed' }, 'run-b'))
  const rows = () => [
    ...document.querySelectorAll<HTMLElement>('[data-slot="assistant-footer"][data-run-id="run-a"], [data-slot="assistant-footer"][data-run-id="run-b"]'),
  ]
  await expect.poll(() => rows().map((r) => r.getAttribute('data-tokens'))).toEqual(['130', '1210'])
  for (const row of rows()) {
    expect(row.textContent).toContain('tok')
    expect(row.getAttribute('data-complete')).toBe('false')
    expect(row.textContent).not.toMatch(/\$|Unpriced/)
  }
  const cost = page.getByRole('button', { name: 'Session cost: $0.0124 (partly Unpriced)' })
  await expect.element(cost).toBeVisible()
  expect(document.querySelector('[data-slot="session-cost"]')!.getAttribute('data-tokens')).toBe('1340')
  // 键盘聚焦打开分项。
  ;(document.querySelector('[data-slot="session-cost"]') as HTMLElement).focus()
  await expect.poll(() => document.querySelector('[data-slot="session-cost-detail"]')).not.toBeNull()
  const part = (key: string) => [...document.querySelectorAll(`[data-usage-part="${key}"] > *`)].map((e) => e.textContent)
  expect(part('input')).toEqual(['Input', '1,100', '$0.0062'])
  expect(part('cacheRead')).toEqual(['Cache read', '20', '$0.00'])
  expect(part('total')).toEqual(['Total', '1,340', '$0.0124'])
})
