// 能力配置：schema 与默认值；合并与诊断。
export { capabilityConfigSchema, CONFIG_SETTING_KEY, defaultCapabilityConfig } from './schema.ts'
export type { CapabilityConfig } from './schema.ts'
export { mergeCapabilityConfig, parseProjectSettings } from './merge.ts'
export type { CapabilityConfigPatch, ParseProjectSettingsOptions, ProjectCapabilityValues, ProjectRuleTexts, ProjectSettings } from './merge.ts'
