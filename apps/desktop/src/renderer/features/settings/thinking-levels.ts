import { THINKING_LEVELS, type ThinkingLevel, type ThinkingLevelConfig } from '@coko/protocol'

/** 一个档位的默认配置：off 没有参数（按协议的默认关闭方式请求），其余档位的参数值默认等于档位名。 */
const configOf = (level: ThinkingLevel): ThinkingLevelConfig => (level === 'off' ? { level } : { level, value: level })

/** 按固定顺序中最早一个尚未配置的预设；七档齐全时为 undefined。 */
export const nextLevel = (levels: readonly ThinkingLevelConfig[]): ThinkingLevel | undefined =>
  THINKING_LEVELS.find((level) => !levels.some((configured) => configured.level === level))

/** “添加档位”：在末尾追加最早缺失的档位；七档齐全时原样返回。 */
export function addLevel(levels: ThinkingLevelConfig[]): ThinkingLevelConfig[] {
  const level = nextLevel(levels)
  return level === undefined ? levels : [...levels, configOf(level)]
}

export const removeLevel = (levels: readonly ThinkingLevelConfig[], index: number): ThinkingLevelConfig[] => levels.filter((_, i) => i !== index)

/** 第 index 行的档位选择项：该行当前档位与尚未配置的预设，按固定顺序。 */
export const levelChoices = (levels: readonly ThinkingLevelConfig[], index: number): ThinkingLevel[] =>
  THINKING_LEVELS.filter((level) => level === levels[index]?.level || !levels.some((configured) => configured.level === level))

/** 修改第 index 行的档位：参数值取新档位的默认值；目标档位已配置在其他行时原样返回，同一模型不出现重复档位。 */
export function changeLevel(levels: ThinkingLevelConfig[], index: number, level: ThinkingLevel): ThinkingLevelConfig[] {
  if (!levelChoices(levels, index).includes(level)) return levels
  return levels.map((configured, i) => (i === index && configured.level !== level ? configOf(level) : configured))
}

/** 编辑第 index 行的参数值；off 行没有参数，原样返回。 */
export function setLevelValue(levels: ThinkingLevelConfig[], index: number, value: string): ThinkingLevelConfig[] {
  const current = levels[index]
  if (current === undefined || current.level === 'off') return levels
  return levels.map((configured, i) => (i === index ? { level: current.level, value } : configured))
}

/** 提交内容：参数值去掉首尾空白，留空时使用档位名。 */
export const normalizeLevels = (levels: readonly ThinkingLevelConfig[]): ThinkingLevelConfig[] =>
  levels.map((configured) => (configured.level === 'off' ? { level: 'off' } : { level: configured.level, value: configured.value.trim() || configured.level }))
