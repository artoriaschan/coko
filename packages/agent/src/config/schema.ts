// 能力配置（M3 规格"配置 schema"）：类型与默认值由票 01 定义；加载、合并（默认 ← 全局 ← 项目）与诊断由票 02 实现。
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
  },
  strict,
)
export type CapabilityConfig = Static<typeof capabilityConfigSchema>

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
  }
}
