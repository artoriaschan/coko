// 分域字典的组合：键为顶层命名空间（例如 skills.title）。新增领域在此登记一次；文案写在各自的领域文件中。
import { commands } from './commands.ts'
import { config } from './config.ts'
import { context } from './context.ts'
import { goal } from './goal.ts'
import { jobs } from './jobs.ts'
import { mcp } from './mcp.ts'
import { memory } from './memory.ts'
import { plan } from './plan.ts'
import { references } from './references.ts'
import { skills } from './skills.ts'
import { todo } from './todo.ts'
import { usage } from './usage.ts'

const DOMAINS = { commands, config, context, goal, jobs, mcp, memory, plan, references, skills, todo, usage }

type Domains = typeof DOMAINS
export type DomainDictionary = { [K in keyof Domains]: Domains[K]['zh'] }

export function domainDictionary(locale: 'zh' | 'en'): DomainDictionary {
  return Object.fromEntries(Object.entries(DOMAINS).map(([key, domain]) => [key, domain[locale]])) as DomainDictionary
}
