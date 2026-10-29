// 分域字典的组合：键为顶层命名空间（例如 skills.title）。新增领域在此登记一次（票 01）；之后各票只改自己的领域文件。
import { commands } from './commands.ts'
import { config } from './config.ts'
import { context } from './context.ts'
import { mcp } from './mcp.ts'
import { memory } from './memory.ts'
import { skills } from './skills.ts'

const DOMAINS = { commands, config, context, mcp, memory, skills }

type Domains = typeof DOMAINS
export type DomainDictionary = { [K in keyof Domains]: Domains[K]['zh'] }

export function domainDictionary(locale: 'zh' | 'en'): DomainDictionary {
  return Object.fromEntries(Object.entries(DOMAINS).map(([key, domain]) => [key, domain[locale]])) as DomainDictionary
}
