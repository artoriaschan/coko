// Session Entry 的 payload（按领域分文件）；server 用 SESSION_ENTRY_PAYLOADS 装配 @coko/session 的注册表。
// 新增或修改某个 kind 的 schema 只改所属领域文件。
import { agentEntryPayloads, type AgentEntryPayloads } from './agents.ts'
import { checkpointEntryPayloads, type CheckpointEntryPayloads } from './checkpoints.ts'
import { contextEntryPayloads, type ContextEntryPayloads } from './context.ts'
import type { EntryPayloadDefinition } from './define.ts'
import { goalEntryPayloads, type GoalEntryPayloads } from './goals.ts'
import { handoffEntryPayloads, type HandoffEntryPayloads } from './handoff.ts'
import { hookEntryPayloads, type HookEntryPayloads } from './hooks.ts'
import { jobEntryPayloads, type JobEntryPayloads } from './jobs.ts'
import { observabilityEntryPayloads, type ObservabilityEntryPayloads } from './observability.ts'
import { permissionEntryPayloads, type PermissionEntryPayloads } from './permissions.ts'
import { planningEntryPayloads, type PlanningEntryPayloads } from './planning.ts'
import { runEntryPayloads, type RunEntryPayloads } from './runs.ts'
import { scheduleEntryPayloads, type ScheduleEntryPayloads } from './schedules.ts'
import { taskEntryPayloads, type TaskEntryPayloads } from './tasks.ts'
import { teamEntryPayloads, type TeamEntryPayloads } from './teams.ts'
import { toolEntryPayloads, type ToolEntryPayloads } from './tools.ts'

export * from './agents.ts'
export * from './checkpoints.ts'
export * from './context.ts'
export * from './goals.ts'
export * from './handoff.ts'
export * from './hooks.ts'
export * from './jobs.ts'
export * from './observability.ts'
export * from './permissions.ts'
export * from './planning.ts'
export * from './runs.ts'
export * from './schedules.ts'
export * from './tasks.ts'
export * from './teams.ts'
export * from './tools.ts'
export type { EntryJson, EntryPayloadDefinition, EntryPayloadVersion } from './define.ts'

/** kind → 当前版本的 payload 类型。 */
export interface SessionEntryPayloads
  extends
    RunEntryPayloads,
    PermissionEntryPayloads,
    ToolEntryPayloads,
    CheckpointEntryPayloads,
    ContextEntryPayloads,
    GoalEntryPayloads,
    TaskEntryPayloads,
    PlanningEntryPayloads,
    JobEntryPayloads,
    HookEntryPayloads,
    AgentEntryPayloads,
    ScheduleEntryPayloads,
    HandoffEntryPayloads,
    TeamEntryPayloads,
    ObservabilityEntryPayloads {}
export type SessionEntryKind = keyof SessionEntryPayloads

/** 全部 kind 的版本、schema 与迁移，传给 @coko/session 的 createPayloadRegistry。 */
export const SESSION_ENTRY_PAYLOADS: readonly EntryPayloadDefinition[] = [
  ...runEntryPayloads,
  ...permissionEntryPayloads,
  ...toolEntryPayloads,
  ...checkpointEntryPayloads,
  ...contextEntryPayloads,
  ...goalEntryPayloads,
  ...taskEntryPayloads,
  ...planningEntryPayloads,
  ...jobEntryPayloads,
  ...hookEntryPayloads,
  ...agentEntryPayloads,
  ...scheduleEntryPayloads,
  ...handoffEntryPayloads,
  ...teamEntryPayloads,
  ...observabilityEntryPayloads,
]
