// 指令文件（docs/subsystems/instructions.md）：Run 开始时用户级与仓库根到 Workspace 的指令组成 <instructions> system section；Workspace
// 子目录的指令在 read / write / edit / grep / find / ls 首次触及时附在 toolResult 末尾（afterToolCall hook）。受 instructions.enabled 控制。
// 当时生效的 Read 拒绝规则（scope.permissionRules）作用于指令文件与 @import，与 File Reference 相同。
import { realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import {
  contextReadDenial,
  createInstructionLoader,
  createNodeInstructionFiles,
  formatInstructionsSection,
  INSTRUCTIONS_SECTION,
  nestedInstructionsHook,
  type InstructionLoader,
  type LoadedInstructions,
} from '@coko/agent'
import { getLogger } from '@coko/logging'
import type { ContextContribution, ContextContributionOptions, ContextReport, ContextScope } from './types.ts'

const log = getLogger(['application', 'context', 'instructions'])

export interface InstructionsDependencies {
  /** 缺省：Node 文件端口与 os.homedir()（仓库根不越过家目录）。 */
  loader?: InstructionLoader
}

const fileSummary = (loaded: LoadedInstructions) => loaded.files.map((f) => ({ path: f.path, scope: f.scope, chars: f.chars, truncated: f.truncated }))

export function instructionsContribution(_options: ContextContributionOptions, dependencies: InstructionsDependencies = {}): ContextContribution {
  // 一个进程一个加载器：其 mtime 缓存跨 Run 复用，文件改动后下一次 Run 重新读取。
  const loader = dependencies.loader ?? createInstructionLoader({ files: createNodeInstructionFiles(), homeDir: homedir() })
  const denialFor = async (scope: ContextScope) => {
    const rules = (await scope.permissionRules?.()) ?? []
    if (rules.length === 0) return undefined
    return contextReadDenial(rules, await realpath(scope.cwd).catch(() => scope.cwd))
  }
  const load = async (scope: ContextScope) => {
    const denied = await denialFor(scope)
    return loader.load({ cwd: scope.cwd, cokoHome: scope.cokoHome, ...(denied ? { denied } : {}) })
  }
  return {
    name: 'instructions',
    async systemSections(scope) {
      if (!scope.config.instructions.enabled) return []
      const loaded = await load(scope)
      const files = fileSummary(loaded)
      log.info('instructions loaded', {
        workspaceId: scope.workspaceId,
        ...(scope.sessionId ? { sessionId: scope.sessionId } : {}),
        files,
        chars: loaded.totalChars,
        diagnostics: loaded.diagnostics.map((d) => ({ code: d.code, ...(d.path ? { path: d.path } : {}) })),
      })
      const text = formatInstructionsSection(loaded.files)
      return text ? [{ name: INSTRUCTIONS_SECTION, text }] : []
    },
    hooks(scope) {
      if (!scope.config.instructions.enabled) return []
      return [
        nestedInstructionsHook({
          loader,
          cwd: scope.cwd,
          cokoHome: scope.cokoHome,
          denied: () => denialFor(scope),
          onLoad: (loaded) =>
            log.info('nested instructions loaded', {
              workspaceId: scope.workspaceId,
              ...(scope.sessionId ? { sessionId: scope.sessionId } : {}),
              files: fileSummary(loaded),
              diagnostics: loaded.diagnostics.map((d) => ({ code: d.code, ...(d.path ? { path: d.path } : {}) })),
            }),
        }),
      ]
    },
    async report(scope): Promise<ContextReport> {
      if (!scope.config.instructions.enabled) return { breakdown: { instructions: 0 }, instructions: [], diagnostics: [] }
      const loaded = await load(scope)
      return {
        breakdown: { instructions: formatInstructionsSection(loaded.files).length },
        instructions: fileSummary(loaded),
        diagnostics: loaded.diagnostics,
      }
    },
  }
}
