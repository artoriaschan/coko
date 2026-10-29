// 仓库契约测试套件：SQLite 实现与内存实现运行同一组用例。普通模块（非 *.test.ts），由各实现的测试文件调用。
import { describe, expect, it, onTestFinished } from 'vitest'
import { StoreError } from './errors.ts'
import { TEST_PAYLOADS } from './test-payloads.ts'
import type { InvalidEntry, NewSessionEntry, SessionStore, StoreOptions } from './types.ts'

export type OpenStore = (options: StoreOptions) => Promise<SessionStore>

async function expectStoreError(promise: Promise<unknown>, code: StoreError['code']): Promise<StoreError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(StoreError)
  expect((error as StoreError).code).toBe(code)
  return error as StoreError
}

export function describeRepositoryContract(name: string, openStore: OpenStore): void {
  describe(`${name}：仓库契约`, () => {
    let clock = 0
    async function open(options: Partial<StoreOptions> = {}): Promise<SessionStore> {
      clock = 1_000
      const store = await openStore({ now: () => clock, payloads: TEST_PAYLOADS, ...options })
      onTestFinished(() => store.close())
      return store
    }
    const tick = (ms = 10) => {
      clock += ms
    }

    it('登记 Workspace，同一路径重复登记返回已有记录', async () => {
      const { sessions } = await open()
      const a = await sessions.registerWorkspace({ path: '/work/alpha' })
      expect(a).toMatchObject({ path: '/work/alpha', name: 'alpha', createdAt: 1_000 })
      tick()
      const b = await sessions.registerWorkspace({ path: '/work/beta', name: '项目 B' })
      const again = await sessions.registerWorkspace({ path: '/work/alpha', name: '别名' })
      expect(again).toEqual(a)
      expect(await sessions.listWorkspaces()).toEqual([a, b])
      expect(await sessions.getWorkspace(b.id)).toEqual(b)
      expect(await sessions.getWorkspace('missing')).toBeUndefined()
    })

    it('在不存在的 Workspace 下创建 Session 以 not-found 拒绝', async () => {
      const { sessions } = await open()
      await expectStoreError(sessions.createSession({ workspaceId: 'missing' }), 'not-found')
      expect(await sessions.listSessions()).toEqual([])
    })

    it('Session 列表按最近更新倒序，可按 Workspace 过滤', async () => {
      const { sessions } = await open()
      const w1 = await sessions.registerWorkspace({ path: '/w1' })
      const w2 = await sessions.registerWorkspace({ path: '/w2' })
      const s1 = await sessions.createSession({ workspaceId: w1.id, title: '第一个' })
      tick()
      const s2 = await sessions.createSession({ workspaceId: w2.id, model: { providerId: 'p', modelId: 'm' } })
      tick()
      const s3 = await sessions.createSession({ workspaceId: w1.id })
      expect(s2).toMatchObject({ title: '', model: { providerId: 'p', modelId: 'm' }, createdAt: 1_010, updatedAt: 1_010 })
      expect((await sessions.listSessions()).map((s) => s.id)).toEqual([s3.id, s2.id, s1.id])

      tick()
      await sessions.appendEntries(s1.id, [{ kind: 'user-message', payload: { text: 'hi' } }])
      expect((await sessions.listSessions()).map((s) => s.id)).toEqual([s1.id, s3.id, s2.id])
      expect((await sessions.listSessions({ workspaceId: w1.id })).map((s) => s.id)).toEqual([s1.id, s3.id])
      expect(await sessions.getSession(s1.id)).toMatchObject({ title: '第一个', updatedAt: 1_030 })
    })

    it('修改标题与模型后读回，并刷新 updatedAt', async () => {
      const { sessions } = await open()
      const w = await sessions.registerWorkspace({ path: '/w' })
      const s = await sessions.createSession({ workspaceId: w.id })
      tick()
      expect(await sessions.setSessionTitle(s.id, '修复登录')).toMatchObject({ title: '修复登录', updatedAt: 1_010 })
      tick()
      await sessions.setSessionModel(s.id, { model: { providerId: 'deepseek', modelId: 'deepseek-chat' } })
      expect(await sessions.getSession(s.id)).toMatchObject({
        title: '修复登录',
        model: { providerId: 'deepseek', modelId: 'deepseek-chat' },
        updatedAt: 1_020,
      })
      await sessions.setSessionModel(s.id, { model: null })
      expect((await sessions.getSession(s.id))?.model).toBeNull()
      await expectStoreError(sessions.setSessionTitle('missing', 'x'), 'not-found')
      await expectStoreError(sessions.setSessionModel('missing', { model: null }), 'not-found')
    })

    it('Thinking Level 与模型一起保存：新建默认 off；换模型时写入给定档位，未给出或清空模型时回到 off', async () => {
      const { sessions } = await open()
      const w = await sessions.registerWorkspace({ path: '/w' })
      const s = await sessions.createSession({ workspaceId: w.id, model: { providerId: 'p', modelId: 'm' } })
      expect(s.thinkingLevel).toBe('off')
      const withLevel = await sessions.createSession({ workspaceId: w.id, model: { providerId: 'p', modelId: 'm' }, thinkingLevel: 'medium' })
      expect((await sessions.getSession(withLevel.id))?.thinkingLevel).toBe('medium')

      tick()
      expect(await sessions.setSessionModel(s.id, { model: { providerId: 'p', modelId: 'm' }, thinkingLevel: 'high' })).toMatchObject({
        thinkingLevel: 'high',
        updatedAt: 1_010,
      })
      expect(await sessions.getSession(s.id)).toMatchObject({ model: { providerId: 'p', modelId: 'm' }, thinkingLevel: 'high' })
      await sessions.setSessionModel(s.id, { model: { providerId: 'p', modelId: 'm2' } })
      expect((await sessions.getSession(s.id))?.thinkingLevel).toBe('off')
      await sessions.setSessionModel(s.id, { model: { providerId: 'p', modelId: 'm' }, thinkingLevel: 'max' })
      await sessions.setSessionModel(s.id, { model: null })
      expect(await sessions.getSession(s.id)).toMatchObject({ model: null, thinkingLevel: 'off' })
    })

    it('追加条目在 Session 内分配连续 seq，payload 原样读回', async () => {
      const { sessions } = await open()
      const w = await sessions.registerWorkspace({ path: '/w' })
      const a = await sessions.createSession({ workspaceId: w.id })
      const b = await sessions.createSession({ workspaceId: w.id })
      const payload = { text: '你好 👋', n: 1.5, nested: [true, null, { deep: 'x' }] }

      const first = await sessions.appendEntries(a.id, [
        { kind: 'user-message', payload, runId: 'run-1' },
        { kind: 'assistant-message', payloadVersion: 2, payload: 'plain' },
      ])
      expect(first).toEqual([
        { sessionId: a.id, seq: 1, kind: 'user-message', payloadVersion: 1, payload, runId: 'run-1', createdAt: 1_000 },
        { sessionId: a.id, seq: 2, kind: 'assistant-message', payloadVersion: 2, payload: 'plain', runId: null, createdAt: 1_000 },
      ])
      expect((await sessions.appendEntries(b.id, [{ kind: 'k', payload: 0 }]))[0]?.seq).toBe(1)
      expect((await sessions.appendEntries(a.id, [{ kind: 'tool-result', payload: [] }]))[0]?.seq).toBe(3)
      expect(await sessions.appendEntries(a.id, [])).toEqual([])

      const all = await sessions.listEntries(a.id)
      expect(all.map((e) => e.seq)).toEqual([1, 2, 3])
      expect(all.slice(0, 2)).toEqual(first)
      expect((await sessions.listEntries(a.id, { afterSeq: 1 })).map((e) => e.seq)).toEqual([2, 3])
      expect((await sessions.listEntries(a.id, { afterSeq: 0, limit: 2 })).map((e) => e.seq)).toEqual([1, 2])
      expect(await sessions.listEntries('missing')).toEqual([])
    })

    it('向不存在的 Session 追加条目以 not-found 拒绝', async () => {
      const { sessions } = await open()
      await expect(sessions.appendEntries('missing', [{ kind: 'k', payload: null }])).rejects.toMatchObject({ name: 'StoreError', code: 'not-found' })
    })

    it('未注册 kind、未登记版本或不合 schema 的 payload 以 invalid-payload 拒绝，同批条目都不提交', async () => {
      const { sessions } = await open()
      const w = await sessions.registerWorkspace({ path: '/w' })
      const s = await sessions.createSession({ workspaceId: w.id })
      const valid = { kind: 'doc', payload: { body: 'ok' } }
      const rejected: NewSessionEntry[] = [
        { kind: 'unknown-kind', payload: {} },
        { kind: 'doc', payload: { body: '' } },
        { kind: 'doc', payloadVersion: 1, payload: { body: 'v2 shape at v1' } },
        { kind: 'doc', payloadVersion: 3, payload: { body: 'future' } },
        { kind: 'doc', payloadVersion: 0, payload: { body: 'zero' } },
      ]
      for (const [index, bad] of rejected.entries()) {
        const error = await expectStoreError(sessions.appendEntries(s.id, [valid, bad]), 'invalid-payload')
        expect(error.fatal).toBe(false)
        expect(error.details).toMatchObject({ index: 1, kind: bad.kind })
        expect(JSON.stringify(error.details), `case ${index}`).not.toContain(JSON.stringify(bad.payload))
      }
      expect(await sessions.listEntries(s.id)).toEqual([])
      expect((await sessions.appendEntries(s.id, [valid]))[0]).toMatchObject({ seq: 1, kind: 'doc', payloadVersion: 2, payload: { body: 'ok' } })
    })

    it('读取时低版本 payload 逐版迁移到当前版本；迁移后仍不合格的条目不返回、报告且保留', async () => {
      const invalid: InvalidEntry[] = []
      const { sessions } = await open({ onInvalidEntry: (entry) => invalid.push(entry) })
      const w = await sessions.registerWorkspace({ path: '/w' })
      const s = await sessions.createSession({ workspaceId: w.id })
      const written = await sessions.appendEntries(s.id, [
        { kind: 'doc', payloadVersion: 1, payload: { text: 'legacy' } },
        { kind: 'doc', payloadVersion: 1, payload: { text: '' } },
        { kind: 'doc', payload: { body: 'current' } },
      ])
      // 提交结果是写入时的原样记录。
      expect(written.map((e) => [e.seq, e.payloadVersion, e.payload])).toEqual([
        [1, 1, { text: 'legacy' }],
        [2, 1, { text: '' }],
        [3, 2, { body: 'current' }],
      ])
      const read = await sessions.listEntries(s.id)
      expect(read.map((e) => [e.seq, e.payloadVersion, e.payload])).toEqual([
        [1, 2, { body: 'legacy' }],
        [3, 2, { body: 'current' }],
      ])
      expect(invalid).toEqual([{ sessionId: s.id, seq: 2, kind: 'doc', payloadVersion: 1, reason: expect.any(String) }])
      // 被跳过的条目仍在存储中：seq 不被复用。
      expect((await sessions.appendEntries(s.id, [{ kind: 'doc', payload: { body: 'next' } }]))[0]?.seq).toBe(4)
      expect((await sessions.listEntries(s.id, { afterSeq: 1 })).map((e) => e.seq)).toEqual([3, 4])
    })

    it('设置按 revision 乐观并发，revision 不匹配返回冲突且值不变', async () => {
      const { settings } = await open()
      expect(await settings.get('theme')).toBeUndefined()
      expect(await settings.set('theme', 'dark', 0)).toEqual({ key: 'theme', value: 'dark', revision: 1, updatedAt: 1_000 })
      tick()
      expect(await settings.set('theme', { mode: 'light' }, 1)).toMatchObject({ value: { mode: 'light' }, revision: 2, updatedAt: 1_010 })

      const stale = await expectStoreError(settings.set('theme', 'dark', 1), 'revision-conflict')
      expect(stale.fatal).toBe(false)
      expect(stale.details).toMatchObject({ key: 'theme', expected: 1, actual: 2 })
      await expectStoreError(settings.set('locale', 'zh', 1), 'revision-conflict')
      await expectStoreError(settings.set('theme', 'dark', 0), 'revision-conflict')

      expect(await settings.get('theme')).toMatchObject({ value: { mode: 'light' }, revision: 2 })
      await settings.set('locale', 'en', 0)
      expect((await settings.list()).map((s) => [s.key, s.revision])).toEqual([
        ['locale', 1],
        ['theme', 2],
      ])
    })

    it('Provider 增改删，Credential 只以提示暴露，密文按字节读回', async () => {
      const { providers } = await open()
      const catalog = [{ id: 'custom-model-1', name: '自定义模型一', contextWindow: 1_000_000, thinkingLevels: [{ level: 'high', value: 'high' }] }]
      const input = { id: 'custom-provider-1', name: '自定义供应商一', api: 'openai-completions', baseUrl: 'https://gateway.example/v1', models: catalog }
      const p = await providers.create(input)
      expect(p).toEqual({ ...input, credential: null, createdAt: 1_000, updatedAt: 1_000 })
      tick()
      const updated = await providers.update(p.id, { api: 'anthropic-messages', models: [...catalog, { id: 'custom-model-2' }] })
      expect(updated).toMatchObject({ id: 'custom-provider-1', api: 'anthropic-messages', models: [...catalog, { id: 'custom-model-2' }], updatedAt: 1_010 })

      const ciphertext = new Uint8Array([0, 1, 2, 250, 255])
      const withCredential = await providers.setCredential(p.id, { ciphertext, hint: 'a1b2' })
      expect(withCredential.credential).toEqual({ hint: 'a1b2' })
      expect(JSON.stringify(await providers.list())).not.toContain('ciphertext')
      expect(Array.from((await providers.getCredentialCiphertext(p.id)) ?? [])).toEqual([0, 1, 2, 250, 255])

      expect((await providers.clearCredential(p.id)).credential).toBeNull()
      expect(await providers.getCredentialCiphertext(p.id)).toBeUndefined()

      await providers.setCredential(p.id, { ciphertext, hint: 'zz99' })
      const other = await providers.create({ ...input, id: 'custom-provider-2', name: '自定义供应商二' })
      expect((await providers.list()).map((x) => x.id)).toEqual(['custom-provider-1', 'custom-provider-2'])
      await providers.delete(p.id)
      expect(await providers.get(p.id)).toBeUndefined()
      expect(await providers.getCredentialCiphertext(p.id)).toBeUndefined()
      expect(await providers.list()).toEqual([other])

      await expectStoreError(providers.update(p.id, { name: 'x' }), 'not-found')
      await expectStoreError(providers.delete(p.id), 'not-found')
      await expectStoreError(providers.setCredential(p.id, { ciphertext, hint: 'x' }), 'not-found')
      await expectStoreError(providers.clearCredential(p.id), 'not-found')
    })

    it('删除 Provider：同一事务删除 Credential、清空引用它的 Session 模型字段（档位回到 off，不改 updatedAt），并按调用方的条件改写设置', async () => {
      const { providers, sessions, settings } = await open()
      const input = { id: 'custom-provider-1', name: '一', api: 'openai-completions', baseUrl: 'https://a.example/v1', models: [{ id: 'm' }] }
      await providers.create(input, { ciphertext: new Uint8Array([1, 2]), hint: 'ab12' })
      await providers.create({ ...input, id: 'custom-provider-2' })
      const w = await sessions.registerWorkspace({ path: '/work/alpha' })
      const a = await sessions.createSession({ workspaceId: w.id, model: { providerId: 'custom-provider-1', modelId: 'm' }, thinkingLevel: 'high' })
      const b = await sessions.createSession({ workspaceId: w.id, model: { providerId: 'custom-provider-1', modelId: 'm' } })
      const other = await sessions.createSession({ workspaceId: w.id, model: { providerId: 'custom-provider-2', modelId: 'm' } })
      const empty = await sessions.createSession({ workspaceId: w.id })
      // 设置的业务含义由调用方给出：这里用任意键与条件，session 只在同一事务中按条件改写。
      await settings.set('pinned', { provider: 'custom-provider-1' }, 0)
      await settings.set('untouched', 'custom-provider-1', 0)
      expect(await providers.references('custom-provider-1')).toEqual({ sessions: 2 })
      expect(await providers.references('custom-provider-2')).toEqual({ sessions: 1 })
      await expectStoreError(providers.references('missing'), 'not-found')

      tick()
      const pointsHere = (value: unknown) => (value as { provider?: unknown } | null)?.provider === 'custom-provider-1'
      expect(await providers.delete('custom-provider-1', { settings: [{ key: 'pinned', when: pointsHere, value: null }] })).toEqual({
        sessions: 2,
        settings: ['pinned'],
      })
      expect(await providers.getCredentialCiphertext('custom-provider-1')).toBeUndefined()
      expect(await sessions.getSession(a.id)).toEqual({ ...a, model: null, thinkingLevel: 'off' })
      expect(await sessions.getSession(b.id)).toEqual({ ...b, model: null })
      expect(await sessions.getSession(other.id)).toEqual(other)
      expect(await sessions.getSession(empty.id)).toEqual(empty)
      // 条件成立的设置改写（revision 递增）；未列出的设置不变。
      expect(await settings.get('pinned')).toEqual({ key: 'pinned', value: null, revision: 2, updatedAt: 1_010 })
      expect(await settings.get('untouched')).toMatchObject({ value: 'custom-provider-1', revision: 1 })

      // 重新创建相同 ID：原 Session 不会接到新 Provider 上。
      await providers.create(input)
      expect(await providers.references('custom-provider-1')).toEqual({ sessions: 0 })
      expect((await sessions.getSession(a.id))?.model).toBeNull()
      expect(await providers.getCredentialCiphertext('custom-provider-1')).toBeUndefined()

      // 条件不成立或设置不存在时不改写；不带 settings 时只删除 Provider。
      await settings.set('pinned', { provider: 'custom-provider-2' }, 2)
      const update = [
        { key: 'pinned', when: pointsHere, value: null },
        { key: 'missing', when: () => true, value: 1 },
      ]
      expect(await providers.delete('custom-provider-1', { settings: update })).toEqual({ sessions: 0, settings: [] })
      expect(await settings.get('pinned')).toMatchObject({ value: { provider: 'custom-provider-2' }, revision: 3 })
      expect(await settings.get('missing')).toBeUndefined()
      await providers.create(input)
      expect(await providers.delete('custom-provider-1')).toEqual({ sessions: 0, settings: [] })
      await expectStoreError(providers.delete('custom-provider-1'), 'not-found')
    })

    it('删除 Provider 时设置改写的条件抛出：整个删除回滚，Provider、Credential、Session 与设置都不变', async () => {
      const { providers, sessions, settings } = await open()
      const input = { id: 'custom-provider-1', name: '一', api: 'openai-completions', baseUrl: 'https://a.example/v1', models: [{ id: 'm' }] }
      const created = await providers.create(input, { ciphertext: new Uint8Array([1, 2]), hint: 'ab12' })
      const w = await sessions.registerWorkspace({ path: '/work/alpha' })
      const a = await sessions.createSession({ workspaceId: w.id, model: { providerId: 'custom-provider-1', modelId: 'm' } })
      await settings.set('pinned', 'x', 0)
      const boom = () => {
        throw new Error('condition failed')
      }
      await expect(providers.delete('custom-provider-1', { settings: [{ key: 'pinned', when: boom, value: null }] })).rejects.toThrow('condition failed')
      expect(await providers.get('custom-provider-1')).toEqual(created)
      expect(Array.from((await providers.getCredentialCiphertext('custom-provider-1')) ?? [])).toEqual([1, 2])
      expect(await sessions.getSession(a.id)).toEqual(a)
      expect(await settings.get('pinned')).toMatchObject({ value: 'x', revision: 1 })
    })

    it('Provider ID 由调用方给出；与已有 Provider 重复时以 already-exists 拒绝，已有记录与 Credential 不变', async () => {
      const { providers } = await open()
      const input = { id: 'custom-provider-1', name: '一', api: 'openai-completions', baseUrl: 'https://a.example/v1', models: [{ id: 'm' }] }
      const first = await providers.create(input)
      const withCredential = await providers.setCredential(first.id, { ciphertext: new Uint8Array([1, 2]), hint: 'ab12' })
      tick()
      const error = await expectStoreError(providers.create({ ...input, name: '二', baseUrl: 'https://b.example/v1' }), 'already-exists')
      expect(error.details).toMatchObject({ entity: 'provider', id: 'custom-provider-1' })
      expect(await providers.list()).toEqual([withCredential])
      expect(Array.from((await providers.getCredentialCiphertext(first.id)) ?? [])).toEqual([1, 2])
    })

    it('一次存储：create 与 update 可同时写入 Credential 密文；update 不带 credential 时保留原密文；重复 ID 时新密文不写入', async () => {
      const { providers } = await open()
      const input = { id: 'custom-provider-1', name: '一', api: 'openai-completions', baseUrl: 'https://a.example/v1', models: [{ id: 'm' }] }
      const created = await providers.create(input, { ciphertext: new Uint8Array([1, 2, 3]), hint: 'aaaa' })
      expect(created).toEqual({ ...input, credential: { hint: 'aaaa' }, createdAt: 1_000, updatedAt: 1_000 })
      expect(Array.from((await providers.getCredentialCiphertext(input.id)) ?? [])).toEqual([1, 2, 3])

      tick()
      const kept = await providers.update(input.id, { name: '一改' })
      expect(kept).toMatchObject({ name: '一改', credential: { hint: 'aaaa' }, updatedAt: 1_010 })
      expect(Array.from((await providers.getCredentialCiphertext(input.id)) ?? [])).toEqual([1, 2, 3])

      tick()
      const replaced = await providers.update(input.id, { baseUrl: 'https://b.example/v1' }, { ciphertext: new Uint8Array([7, 7]), hint: 'bbbb' })
      expect(replaced).toMatchObject({ baseUrl: 'https://b.example/v1', credential: { hint: 'bbbb' }, updatedAt: 1_020 })
      expect(Array.from((await providers.getCredentialCiphertext(input.id)) ?? [])).toEqual([7, 7])

      await expectStoreError(providers.create({ ...input, name: '二' }, { ciphertext: new Uint8Array([9]), hint: 'cccc' }), 'already-exists')
      await expectStoreError(providers.update('missing', { name: 'x' }, { ciphertext: new Uint8Array([9]), hint: 'cccc' }), 'not-found')
      expect(await providers.list()).toEqual([replaced])
      expect(Array.from((await providers.getCredentialCiphertext(input.id)) ?? [])).toEqual([7, 7])
      expect(await providers.getCredentialCiphertext('missing')).toBeUndefined()
    })

    it('Memory：按作用域与 Workspace 列出（最近更新在前），改正文刷新 updatedAt，删除后不可读', async () => {
      const { sessions, memories } = await open()
      const w1 = await sessions.registerWorkspace({ path: '/w1' })
      const w2 = await sessions.registerWorkspace({ path: '/w2' })
      const user = await memories.create({ scope: 'user', content: 'prefers pnpm', source: 'agent' })
      expect(user).toEqual({ id: user.id, scope: 'user', workspaceId: null, content: 'prefers pnpm', source: 'agent', createdAt: 1_000, updatedAt: 1_000 })
      tick()
      const a = await memories.create({ scope: 'workspace', workspaceId: w1.id, content: 'uses vitest', source: 'user' })
      tick()
      const b = await memories.create({ scope: 'workspace', workspaceId: w2.id, content: 'monorepo', source: 'agent' })
      expect((await memories.list()).map((m) => m.id)).toEqual([b.id, a.id, user.id])
      expect((await memories.list({ scope: 'user' })).map((m) => m.id)).toEqual([user.id])
      expect((await memories.list({ scope: 'workspace', workspaceId: w1.id })).map((m) => m.id)).toEqual([a.id])

      tick()
      expect(await memories.update(user.id, { content: 'prefers pnpm 12' })).toMatchObject({ content: 'prefers pnpm 12', createdAt: 1_000, updatedAt: 1_030 })
      expect((await memories.list()).map((m) => m.id)).toEqual([user.id, b.id, a.id])
      expect(await memories.get(a.id)).toEqual(a)

      await memories.delete(a.id)
      expect(await memories.get(a.id)).toBeUndefined()
      await expectStoreError(memories.delete(a.id), 'not-found')
      await expectStoreError(memories.update(a.id, { content: 'x' }), 'not-found')
    })

    it('Memory：作用域与 workspaceId 不一致 invalid-input，Workspace 不存在 not-found，均不写入', async () => {
      const { sessions, memories } = await open()
      const w = await sessions.registerWorkspace({ path: '/w' })
      await expectStoreError(memories.create({ scope: 'workspace', content: 'x', source: 'agent' }), 'invalid-input')
      await expectStoreError(memories.create({ scope: 'user', workspaceId: w.id, content: 'x', source: 'agent' }), 'invalid-input')
      await expectStoreError(memories.create({ scope: 'workspace', workspaceId: 'missing', content: 'x', source: 'agent' }), 'not-found')
      expect(await memories.list()).toEqual([])
    })

    it('Secret：list 只返回 name 与 hint（不含密文），密文按字节读回，替换与删除', async () => {
      const { secrets } = await open()
      const ciphertext = new Uint8Array([9, 0, 255, 128])
      expect(await secrets.setCiphertext('MY_TOKEN', { ciphertext, hint: 'ab12' })).toEqual({ name: 'MY_TOKEN', hint: 'ab12', updatedAt: 1_000 })
      await secrets.setCiphertext('A_KEY', { ciphertext: new Uint8Array([1]), hint: 'zz00' })
      const listed = await secrets.list()
      expect(listed).toEqual([
        { name: 'A_KEY', hint: 'zz00', updatedAt: 1_000 },
        { name: 'MY_TOKEN', hint: 'ab12', updatedAt: 1_000 },
      ])
      expect(listed.every((s) => Object.keys(s).toSorted().join() === 'hint,name,updatedAt')).toBe(true)
      expect(Array.from((await secrets.getCiphertext('MY_TOKEN')) ?? [])).toEqual([9, 0, 255, 128])

      tick()
      await secrets.setCiphertext('MY_TOKEN', { ciphertext: new Uint8Array([7]), hint: 'cd34' })
      expect(await secrets.list()).toContainEqual({ name: 'MY_TOKEN', hint: 'cd34', updatedAt: 1_010 })
      expect(Array.from((await secrets.getCiphertext('MY_TOKEN')) ?? [])).toEqual([7])

      await secrets.delete('MY_TOKEN')
      expect(await secrets.getCiphertext('MY_TOKEN')).toBeUndefined()
      await expectStoreError(secrets.delete('MY_TOKEN'), 'not-found')
    })

    it('关闭后所有操作以 closed 拒绝，重复关闭无副作用', async () => {
      const store = await open()
      await store.close()
      await store.close()
      for (const attempt of [
        store.sessions.listWorkspaces(),
        store.settings.set('k', 1, 0),
        store.providers.list(),
        store.memories.list(),
        store.secrets.list(),
      ]) {
        await expect(attempt).rejects.toMatchObject({ name: 'StoreError', code: 'closed' })
      }
    })
  })
}
