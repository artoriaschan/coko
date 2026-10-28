// 条目 payload 的两份定义（@coko/agent 注册并校验、@coko/protocol 在客户端信任边界校验）必须一致：任一侧增删 kind 或改动 schema 而
// 另一侧未跟上时，这里编译失败（renderer 会静默跳过不合格的条目，运行时很难发现）。server 是同时引用两者的一层。
import type { SessionEntryKind as AgentEntryKind, SessionEntryPayloads } from '@coko/agent'
import type { SESSION_ENTRY_PAYLOAD_SCHEMAS, SessionEntryKind as ProtocolEntryKind } from '@coko/protocol'
import type { Static } from 'typebox'

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T
type ProtocolPayload<K extends ProtocolEntryKind> = Static<(typeof SESSION_ENTRY_PAYLOAD_SCHEMAS)[K]>

export type EntryKindsAgree = Assert<Equal<AgentEntryKind, ProtocolEntryKind>>

/** message 以外的 kind：两侧的 payload 类型相同。 */
type Structured = Exclude<ProtocolEntryKind, 'message'>
export type EntryPayloadsAgree = Assert<{ [K in Structured]: Equal<SessionEntryPayloads[K], ProtocolPayload<K>> }[Structured]>
