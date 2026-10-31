// 分域字典的组合：键为顶层命名空间（例如 skills.title）。新增领域在此登记一次；文案写在各自的领域文件中。
import { agents } from './agents.ts'
import { commands } from './commands.ts'
import { config } from './config.ts'
import { context } from './context.ts'
import { goal } from './goal.ts'
import { handoff } from './handoff.ts'
import { hooks } from './hooks.ts'
import { jobs } from './jobs.ts'
import { lsp } from './lsp.ts'
import { mcp } from './mcp.ts'
import { notifications } from './notifications.ts'
import { memory } from './memory.ts'
import { plan } from './plan.ts'
import { plugins } from './plugins.ts'
import { references } from './references.ts'
import { schedules } from './schedules.ts'
import { skills } from './skills.ts'
import { teams } from './teams.ts'
import { todo } from './todo.ts'
import { trace } from './trace.ts'
import { update } from './update.ts'
import { usage } from './usage.ts'
import { worktrees } from './worktrees.ts'

const DOMAINS = {
  commands,
  config,
  context,
  goal,
  jobs,
  mcp,
  memory,
  plan,
  references,
  skills,
  todo,
  usage,
  hooks,
  agents,
  schedules,
  worktrees,
  handoff,
  notifications,
  plugins,
  lsp,
  teams,
  trace,
  update,
}

type Domains = typeof DOMAINS
export type DomainDictionary = { [K in keyof Domains]: Domains[K]['zh'] }

export function domainDictionary(locale: 'zh' | 'en'): DomainDictionary {
  return Object.fromEntries(Object.entries(DOMAINS).map(([key, domain]) => [key, domain[locale]])) as DomainDictionary
}
