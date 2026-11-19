// 记忆集成用例共用的辅助：faux requestLog 中的消息形状、Memory 段各层的计数、FTS5 与强制降级两种模式。

/** faux requestLog 一行中的一条消息（只列出记忆用例读取的字段）。 */
export type LoggedMessage = { role: string; sections?: Record<string, string | null>; toolCallId?: string; isError?: boolean; content?: { text?: string }[] }

/** 请求中的 Memory 段。 */
export const memorySection = (request: LoggedMessage[]) => request.map((m) => m.sections?.memory).find(Boolean)!

/** Memory 段中某个作用域在正文层与摘要层的条数。 */
export const tiersOf = (section: string, scope: 'user' | 'workspace') => ({
  full: section.match(new RegExp(`<entry [^>]*scope="${scope}"`, 'g'))?.length ?? 0,
  summary: section.match(new RegExp(`<summary [^>]*scope="${scope}"`, 'g'))?.length ?? 0,
})

/** Memory 段末注明的未放入条数；没有时为 0。 */
export const omittedOf = (section: string) => Number(/(\d+) more entr(?:y|ies) not shown/.exec(section)?.[1] ?? 0)

/** 同一组用例在 FTS5 与强制降级（COKO_TEST_NO_FTS=1）下各跑一次。 */
export const ftsModes = [
  { name: 'FTS5', env: {} as Record<string, string>, fts: true },
  { name: '强制降级（COKO_TEST_NO_FTS=1）', env: { COKO_TEST_NO_FTS: '1' } as Record<string, string>, fts: false },
]
