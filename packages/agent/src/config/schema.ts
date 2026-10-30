// 能力配置（docs/subsystems/configuration.md）：类型与默认值；加载、合并（默认 ← 全局 ← 项目）与诊断在 merge.ts。
// 项目 .coko/settings.json 只能收紧（ADR 0008）。
import { Type, type Static } from 'typebox'

const strict = { additionalProperties: false } as const
const Names = Type.Array(Type.String({ minLength: 1 }))

export const capabilityConfigSchema = Type.Object(
  {
    instructions: Type.Object({ enabled: Type.Boolean() }, strict),
    skills: Type.Object({ enabled: Type.Boolean(), disabled: Names }, strict),
    commands: Type.Object({ enabled: Type.Boolean(), disabled: Names }, strict),
    mcp: Type.Object({ enabled: Type.Boolean() }, strict),
    memory: Type.Object({ enabled: Type.Boolean() }, strict),
    context: Type.Object({ autoCompact: Type.Boolean(), trimOldToolResults: Type.Boolean() }, strict),
    /** 外部 Hook（ADR 0013）：只在全局设置；项目文件中的 hooks.enabled 以 project-cannot-grant 忽略。 */
    hooks: Type.Object({ enabled: Type.Boolean() }, strict),
    /** 子代理（ADR 0014）：项目可关闭。 */
    agents: Type.Object({ enabled: Type.Boolean() }, strict),
    /** 定时任务（ADR 0015）：项目可关闭。 */
    schedules: Type.Object({ enabled: Type.Boolean() }, strict),
  },
  strict,
)
export type CapabilityConfig = Static<typeof capabilityConfigSchema>

/**
 * 只能在全局设置的分区：项目文件中的这些键不收紧能力，而是另有用途或不被接受（hooks 键在项目文件中是项目 Hook 的配置，由 Hook 的加载读取）。
 */
export const GLOBAL_ONLY_SECTIONS: ReadonlySet<keyof CapabilityConfig> = new Set(['hooks'])

/** 设置键：全局能力配置只能经 PUT /api/config 修改。 */
export const CONFIG_SETTING_KEY = 'config'

/** 默认值：全部能力开启，没有被禁用的 Skill 或命令。每次返回新对象。 */
export function defaultCapabilityConfig(): CapabilityConfig {
  return {
    instructions: { enabled: true },
    skills: { enabled: true, disabled: [] },
    commands: { enabled: true, disabled: [] },
    mcp: { enabled: true },
    memory: { enabled: true },
    context: { autoCompact: true, trimOldToolResults: true },
    hooks: { enabled: true },
    agents: { enabled: true },
    schedules: { enabled: true },
  }
}
