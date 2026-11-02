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

    it('宿主幂等身份不覆盖已有会话；删除会话树清理记录并保留工作目录登记直到显式移除', async () => {
      const store = await open()
      const w = await store.sessions.registerWorkspace({ path: '/standalone' })
      const root = await store.sessions.createSession({ id: 'stable-draft-session', workspaceId: w.id })
      const child = await store.sessions.createSession({ workspaceId: w.id, parentSessionId: root.id })
      await store.sessions.appendEntries(root.id, [{ kind: 'note', payload: 'root' }])
      await store.sessions.appendEntries(child.id, [{ kind: 'note', payload: 'child' }])
      await expectStoreError(store.sessions.createSession({ id: root.id, workspaceId: w.id, title: 'overwrite' }), 'already-exists')
      expect(await store.sessions.deleteWorkspaceIfUnused(w.id)).toBe(false)
      await store.sessions.deleteSession(root.id)
      expect(await store.sessions.getSession(root.id)).toBeUndefined()
      expect(await store.sessions.getSession(child.id)).toBeUndefined()
      expect(await store.sessions.listEntries(child.id)).toEqual([])
      expect(await store.sessions.getWorkspace(w.id)).toEqual(w)
      expect(await store.sessions.deleteWorkspaceIfUnused(w.id)).toBe(true)
      expect(await store.sessions.getWorkspace(w.id)).toBeUndefined()
    })

    it('删除树清理所有层级的条目、定时任务与进程登记，保留共享目录、worktree 和其他会话', async () => {
      const store = await open()
      const workspace = await store.sessions.registerWorkspace({ path: '/repo' })
      const worktree = await store.worktrees.create({
        workspaceId: workspace.id,
        name: 'keep',
        path: '/repo/.coko-worktrees/keep',
        branch: 'coko/keep',
        baseCommit: 'abc',
        repoRoot: '/repo',
        createdBy: 'user',
      })
      const root = await store.sessions.createSession({ workspaceId: workspace.id, worktreeId: worktree.id })
      const child = await store.sessions.createSession({ workspaceId: workspace.id, parentSessionId: root.id })
      const grandchild = await store.sessions.createSession({ workspaceId: workspace.id, parentSessionId: child.id })
      const retained = await store.sessions.createSession({ workspaceId: workspace.id })
      for (const session of [root, child, grandchild, retained]) {
        await store.sessions.appendEntries(session.id, [{ kind: 'note', payload: 'keep only unrelated' }])
        await store.schedules.create({ sessionId: session.id, title: 'future', prompt: 'work', rule: { kind: 'every', seconds: 600 }, nextAt: 100000 })
        await store.processes.register({ id: session.id, sessionId: session.id, pid: 10, startedAt: 'x', kind: 'job', command: 'done' })
      }
      expect(new Set(await store.sessions.deleteSession(root.id))).toEqual(new Set([root.id, child.id, grandchild.id]))
      for (const session of [root, child, grandchild]) {
        expect(await store.sessions.getSession(session.id)).toBeUndefined()
        expect(await store.sessions.listEntries(session.id)).toEqual([])
      }
      expect((await store.schedules.list()).map((schedule) => schedule.sessionId)).toEqual([retained.id])
      expect((await store.processes.list()).map((process) => process.sessionId)).toEqual([retained.id])
      expect(await store.worktrees.get(worktree.id)).toEqual(worktree)
      expect(await store.sessions.getWorkspace(workspace.id)).toEqual(workspace)
      expect(await store.sessions.listEntries(retained.id)).toHaveLength(1)
    })

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

    it('项目保存完整组织字段，主要 Workspace 唯一，根会话继承项目而子会话不单独保存归属', async () => {
      const store = await open()
      const w = await store.sessions.registerWorkspace({ path: '/project' })
      const project = await store.projects.create({ name: 'Project', primaryWorkspaceId: w.id, additionalFolders: ['/extra', '/more'], primaryFolderIndex: 1 })
      expect(await store.projects.get(project.id)).toEqual({ ...project, pinnedAt: null, additionalFolders: ['/extra', '/more'], primaryFolderIndex: 1 })
      await expectStoreError(store.projects.create({ name: 'duplicate', primaryWorkspaceId: w.id }), 'already-exists')
      const root = await store.sessions.createSession({ workspaceId: w.id })
      expect(root).toMatchObject({ projectId: project.id, pinnedAt: null, archivedAt: null })
      const child = await store.sessions.createSession({ workspaceId: w.id, parentSessionId: root.id })
      expect(child.projectId).toBeNull()
      tick()
      const changed = await store.sessions.setSessionOrganization(root.id, { projectId: null, pinnedAt: 123, archivedAt: 456 })
      expect(await store.sessions.getSession(root.id)).toMatchObject({ projectId: null, pinnedAt: 123, archivedAt: 456, updatedAt: root.updatedAt })
      expect(changed.workspaceId).toBe(w.id)
      expect(await store.projects.list()).toEqual([project])
      expect(await store.projects.update(project.id, { name: 'Renamed', additionalFolders: ['/more'], pinnedAt: 789 })).toMatchObject({
        name: 'Renamed',
        additionalFolders: ['/more'],
        pinnedAt: 789,
      })
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

    it('修改标题与模型后读回，不改变最后记录时间', async () => {
      const { sessions } = await open()
      const w = await sessions.registerWorkspace({ path: '/w' })
      const s = await sessions.createSession({ workspaceId: w.id })
      tick()
      expect(await sessions.setSessionTitle(s.id, '修复登录')).toMatchObject({ title: '修复登录', updatedAt: 1_000 })
      tick()
      await sessions.setSessionModel(s.id, { model: { providerId: 'deepseek', modelId: 'deepseek-chat' } })
      expect(await sessions.getSession(s.id)).toMatchObject({
        title: '修复登录',
        model: { providerId: 'deepseek', modelId: 'deepseek-chat' },
        updatedAt: 1_000,
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
        updatedAt: 1_000,
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
      // 被清空的 Session 带 modelCleared（下次运行前要求重新选择）；从未设置模型的 Session 不带。
      expect(empty.modelCleared).toBe(false)
      expect(await sessions.getSession(a.id)).toEqual({ ...a, model: null, thinkingLevel: 'off', modelCleared: true })
      expect(await sessions.getSession(b.id)).toEqual({ ...b, model: null, modelCleared: true })
      expect(await sessions.getSession(other.id)).toEqual(other)
      expect(await sessions.getSession(empty.id)).toEqual(empty)
      // 重新选择模型后不再是被清空。
      expect(await sessions.setSessionModel(b.id, { model: { providerId: 'custom-provider-2', modelId: 'm' } })).toMatchObject({ modelCleared: false })
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

    it('Memory 检索：全部词出现才匹配（大小写不敏感，含中文），作用域过滤与 list 相同，limit 缺省 20，空查询为空', async () => {
      const { sessions, memories } = await open()
      const w1 = await sessions.registerWorkspace({ path: '/w1' })
      const pnpm = await memories.create({ scope: 'user', content: 'Prefers PNPM over npm for installs', source: 'agent' })
      tick()
      const vitest = await memories.create({ scope: 'workspace', workspaceId: w1.id, content: 'Tests run with vitest; use pnpm test', source: 'user' })
      tick()
      const zh = await memories.create({ scope: 'user', content: '部署前先运行数据库迁移脚本', source: 'user' })
      const ids = async (query: string, options?: Parameters<typeof memories.search>[1]) => (await memories.search(query, options)).map((m) => m.id).toSorted()
      expect(await ids('pnpm')).toEqual([pnpm.id, vitest.id].toSorted())
      expect(await ids('PNPM test')).toEqual([vitest.id])
      expect(await ids('pnpm', { scope: 'user' })).toEqual([pnpm.id])
      expect(await ids('pnpm', { scope: 'workspace', workspaceId: w1.id })).toEqual([vitest.id])
      expect(await ids('数据库迁移')).toEqual([zh.id])
      expect(await ids('np')).toEqual([pnpm.id, vitest.id].toSorted())
      expect(await ids('yarn')).toEqual([])
      expect(await memories.search('   ')).toEqual([])
      expect(await memories.search('pnpm', { limit: 1 })).toHaveLength(1)
      for (let i = 0; i < 25; i++) await memories.create({ scope: 'user', content: `note ${i} about caching`, source: 'agent' })
      expect(await memories.search('caching')).toHaveLength(20)

      // 改正文与删除后检索结果同步。
      await memories.update(pnpm.id, { content: 'Prefers yarn now' })
      expect(await ids('pnpm')).toEqual([vitest.id])
      expect(await ids('yarn')).toEqual([pnpm.id])
      await memories.delete(vitest.id)
      expect(await ids('vitest')).toEqual([])
    })

    it('插件：upsert 新建为未批准、未启用；更新保留批准与启用；approve / setEnabled / delete；path 唯一，来源未知 invalid-input', async () => {
      const { plugins } = await open()
      const input = {
        name: 'sample',
        version: '1.0.0',
        sourceKind: 'dir' as const,
        sourceLocation: '/src/sample',
        path: '/home/.coko/plugins/sample',
        digest: 'd1',
      }
      const created = await plugins.upsert(input)
      expect(created).toEqual({ ...input, sourceRef: null, commit: null, approvedDigest: null, enabled: false, installedAt: 1_000, updatedAt: 1_000 })
      tick()
      expect(await plugins.approve('sample', 'd1')).toMatchObject({ approvedDigest: 'd1', enabled: true, updatedAt: 1_010 })
      tick()
      const updated = await plugins.upsert({
        ...input,
        version: '1.1.0',
        digest: 'd2',
        sourceKind: 'git',
        sourceLocation: 'https://x/y.git',
        sourceRef: 'v1',
        commit: 'abc',
      })
      expect(updated).toMatchObject({
        version: '1.1.0',
        digest: 'd2',
        approvedDigest: 'd1',
        enabled: true,
        installedAt: 1_000,
        updatedAt: 1_020,
        commit: 'abc',
        sourceRef: 'v1',
      })
      expect(await plugins.setEnabled('sample', false)).toMatchObject({ enabled: false })
      await plugins.upsert({ ...input, name: 'another', path: '/home/.coko/plugins/another' })
      expect((await plugins.list()).map((p) => p.name)).toEqual(['another', 'sample'])
      await expectStoreError(plugins.upsert({ ...input, name: 'third' }), 'already-exists')
      await expectStoreError(plugins.upsert({ ...input, name: 'bad', path: '/p/bad', sourceKind: 'npm' as never }), 'invalid-input')
      await expectStoreError(plugins.approve('missing', 'd'), 'not-found')
      await expectStoreError(plugins.setEnabled('missing', true), 'not-found')
      await plugins.delete('sample')
      expect(await plugins.get('sample')).toBeUndefined()
      await expectStoreError(plugins.delete('sample'), 'not-found')
      expect((await plugins.list()).map((p) => p.name)).toEqual(['another'])
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

    it('子进程登记：register 原样读回（可空字段为 null），list 按登记顺序，remove 幂等', async () => {
      const { processes } = await open()
      const job = await processes.register({
        id: 'p1',
        pid: 4242,
        pgid: 4242,
        startedAt: 'Thu Oct 30 14:22:09 2026',
        kind: 'job',
        sessionId: 's1',
        jobId: 'j1',
        command: 'npm run dev',
      })
      expect(job).toEqual({
        id: 'p1',
        pid: 4242,
        pgid: 4242,
        startedAt: 'Thu Oct 30 14:22:09 2026',
        kind: 'job',
        sessionId: 's1',
        jobId: 'j1',
        command: 'npm run dev',
        createdAt: 1_000,
      })
      tick()
      const mcp = await processes.register({ id: 'p2', pid: 77, startedAt: 'Thu Oct 30 14:22:10 2026', kind: 'mcp', command: 'node server.mjs' })
      expect(mcp).toMatchObject({ pgid: null, sessionId: null, jobId: null, createdAt: 1_010 })
      expect((await processes.list()).map((p) => p.id)).toEqual(['p1', 'p2'])
      await processes.remove('p1')
      await processes.remove('p1')
      await processes.remove('missing')
      expect(await processes.list()).toEqual([mcp])
    })

    it('子进程登记：重复 id already-exists，pid / pgid 非正整数与未知 kind invalid-input，均不写入', async () => {
      const { processes } = await open()
      const base = { id: 'p1', pid: 10, startedAt: 'x', kind: 'bash' as const, command: 'ls' }
      await processes.register(base)
      await expectStoreError(processes.register({ ...base, pid: 11 }), 'already-exists')
      await expectStoreError(processes.register({ ...base, id: 'p2', pid: 0 }), 'invalid-input')
      await expectStoreError(processes.register({ ...base, id: 'p3', pid: 1.5 }), 'invalid-input')
      await expectStoreError(processes.register({ ...base, id: 'p4', pgid: -1 }), 'invalid-input')
      await expectStoreError(processes.register({ ...base, id: 'p5', kind: 'daemon' as never }), 'invalid-input')
      expect((await processes.list()).map((p) => [p.id, p.pid])).toEqual([['p1', 10]])
    })

    it('子 Session：createSession 带 parentSessionId，listSessions 不含子 Session，listChildren 按创建顺序列出', async () => {
      const { sessions } = await open()
      const w = await sessions.registerWorkspace({ path: '/w' })
      const other = await sessions.registerWorkspace({ path: '/other' })
      const root = await sessions.createSession({ workspaceId: w.id })
      expect(root).toMatchObject({ parentSessionId: null, worktreeId: null })
      tick()
      const c1 = await sessions.createSession({ workspaceId: w.id, parentSessionId: root.id })
      tick()
      const c2 = await sessions.createSession({ workspaceId: w.id, parentSessionId: root.id })
      expect(c1).toMatchObject({ parentSessionId: root.id, worktreeId: null })
      expect((await sessions.listSessions()).map((s) => s.id)).toEqual([root.id])
      expect((await sessions.listSessions({ workspaceId: w.id })).map((s) => s.id)).toEqual([root.id])
      expect((await sessions.listChildren(root.id)).map((s) => s.id)).toEqual([c1.id, c2.id])
      expect(await sessions.listChildren(c1.id)).toEqual([])
      expect(await sessions.getSession(c2.id)).toEqual(c2)
      // 追加条目刷新子 Session 的 updatedAt，但它仍不出现在列表中。
      tick()
      await sessions.appendEntries(c1.id, [{ kind: 'note', payload: { n: 1 } }])
      expect((await sessions.listSessions()).map((s) => s.id)).toEqual([root.id])
      await expectStoreError(sessions.createSession({ workspaceId: w.id, parentSessionId: 'missing' }), 'not-found')
      await expectStoreError(sessions.createSession({ workspaceId: other.id, parentSessionId: root.id }), 'invalid-input')
      expect(await sessions.listSessions({ workspaceId: other.id })).toEqual([])
    })

    it('worktree：create / get / list（含 removed，按创建顺序），markRemoved 幂等；Session 可绑定同一 Workspace 的 worktree', async () => {
      const { sessions, worktrees } = await open()
      const w = await sessions.registerWorkspace({ path: '/repo/app' })
      const other = await sessions.registerWorkspace({ path: '/elsewhere' })
      const input = {
        workspaceId: w.id,
        name: 'a',
        path: '/repo/.coko-worktrees/a',
        branch: 'coko/a',
        baseCommit: 'abc',
        repoRoot: '/repo',
        createdBy: 'user' as const,
      }
      const a = await worktrees.create(input)
      expect(a).toMatchObject({ ...input, status: 'active', createdAt: 1_000, removedAt: null })
      tick()
      const b = await worktrees.create({ ...input, name: 'b', path: '/repo/.coko-worktrees/b', branch: 'coko/b', createdBy: 'subagent' })
      expect(await worktrees.get(a.id)).toEqual(a)
      expect(await worktrees.get('missing')).toBeUndefined()
      expect((await worktrees.list(w.id)).map((x) => x.id)).toEqual([a.id, b.id])
      expect(await worktrees.list(other.id)).toEqual([])

      const bound = await sessions.createSession({ workspaceId: w.id, worktreeId: a.id })
      expect(bound.worktreeId).toBe(a.id)
      await expectStoreError(sessions.createSession({ workspaceId: other.id, worktreeId: a.id }), 'invalid-input')
      await expectStoreError(sessions.createSession({ workspaceId: w.id, worktreeId: 'missing' }), 'not-found')

      tick()
      const removed = await worktrees.markRemoved(a.id)
      expect(removed).toMatchObject({ status: 'removed', removedAt: 1_020 })
      tick()
      expect(await worktrees.markRemoved(a.id)).toEqual(removed)
      expect((await worktrees.list(w.id)).map((x) => [x.id, x.status])).toEqual([
        [a.id, 'removed'],
        [b.id, 'active'],
      ])
      // 绑定 removed worktree 的 Session 照常可读。
      expect((await sessions.getSession(bound.id))?.worktreeId).toBe(a.id)
      await expectStoreError(worktrees.markRemoved('missing'), 'not-found')
    })

    it('worktree：Workspace 不存在 not-found，path 重复（含已移除的）already-exists，createdBy 未知 invalid-input，均不写入', async () => {
      const { sessions, worktrees } = await open()
      const w = await sessions.registerWorkspace({ path: '/repo' })
      const input = {
        workspaceId: w.id,
        name: 'a',
        path: '/repo/.coko-worktrees/a',
        branch: 'coko/a',
        baseCommit: 'abc',
        repoRoot: '/repo',
        createdBy: 'user' as const,
      }
      await expectStoreError(worktrees.create({ ...input, workspaceId: 'missing' }), 'not-found')
      const a = await worktrees.create(input)
      await worktrees.markRemoved(a.id)
      await expectStoreError(worktrees.create({ ...input, name: 'again' }), 'already-exists')
      await expectStoreError(worktrees.create({ ...input, path: '/repo/.coko-worktrees/c', createdBy: 'robot' as never }), 'invalid-input')
      expect((await worktrees.list(w.id)).map((x) => x.name)).toEqual(['a'])
    })

    it('定时任务 get：按 id 读一条（与 list 中的记录相同）；不存在或已删除时 undefined', async () => {
      const { sessions, schedules } = await open()
      const w = await sessions.registerWorkspace({ path: '/w' })
      const s1 = await sessions.createSession({ workspaceId: w.id })
      const a = await schedules.create({ sessionId: s1.id, title: 'a', prompt: 'p', rule: { kind: 'every', seconds: 60 }, nextAt: 5_000 })
      const b = await schedules.create({ sessionId: s1.id, title: 'b', prompt: 'p', rule: { kind: 'at' }, nextAt: null, status: 'paused' })
      expect(await schedules.get(a.id)).toEqual(a)
      expect(await schedules.get(b.id)).toEqual((await schedules.list()).find((x) => x.id === b.id))
      const edited = await schedules.update(a.id, 1, { title: 'renamed' })
      expect(await schedules.get(a.id)).toEqual(edited)
      await schedules.delete(a.id)
      expect(await schedules.get(a.id)).toBeUndefined()
      expect(await schedules.get('missing')).toBeUndefined()
    })

    it('定时任务：create / update（revision 乐观并发）/ delete / list（可按 Session）/ due（active 且到期，按 nextAt）', async () => {
      const { sessions, schedules } = await open()
      const w = await sessions.registerWorkspace({ path: '/w' })
      const s1 = await sessions.createSession({ workspaceId: w.id })
      const s2 = await sessions.createSession({ workspaceId: w.id })
      const rule = { kind: 'every', seconds: 60 }
      const a = await schedules.create({ sessionId: s1.id, title: 'check', prompt: 'look', rule, nextAt: 5_000 })
      expect(a).toMatchObject({
        sessionId: s1.id,
        title: 'check',
        prompt: 'look',
        rule,
        status: 'active',
        nextAt: 5_000,
        lastOccurrence: null,
        revision: 1,
        createdAt: 1_000,
      })
      tick()
      const b = await schedules.create({ sessionId: s2.id, title: 'b', prompt: 'p', rule: { kind: 'after', seconds: 1 }, nextAt: 3_000 })
      tick()
      const c = await schedules.create({ sessionId: s1.id, title: 'c', prompt: 'p', rule, nextAt: 2_000, status: 'paused' })
      expect((await schedules.list()).map((x) => x.id)).toEqual([a.id, b.id, c.id])
      expect((await schedules.list({ sessionId: s1.id })).map((x) => x.id)).toEqual([a.id, c.id])
      expect((await schedules.due(4_000)).map((x) => x.id)).toEqual([b.id])
      expect((await schedules.due(5_000)).map((x) => x.id)).toEqual([b.id, a.id])

      tick()
      const edited = await schedules.update(a.id, 1, { title: 'renamed', nextAt: 9_000, status: 'paused' })
      expect(edited).toMatchObject({ title: 'renamed', prompt: 'look', nextAt: 9_000, status: 'paused', revision: 2, updatedAt: 1_030 })
      const conflict = await expectStoreError(schedules.update(a.id, 1, { title: 'stale' }), 'revision-conflict')
      expect(conflict.details).toMatchObject({ expected: 1, actual: 2 })
      expect(await schedules.update(a.id, 2, { nextAt: null, status: 'active' })).toMatchObject({ nextAt: null, revision: 3 })
      expect((await schedules.due(100_000)).map((x) => x.id)).toEqual([b.id])
      await expectStoreError(schedules.update(a.id, 3, { status: 'sleeping' as never }), 'invalid-input')
      await expectStoreError(schedules.update('missing', 1, {}), 'not-found')

      await schedules.delete(b.id)
      await expectStoreError(schedules.delete(b.id), 'not-found')
      expect((await schedules.list()).map((x) => x.id)).toEqual([a.id, c.id])
      await expectStoreError(schedules.create({ sessionId: 'missing', title: 't', prompt: 'p', rule, nextAt: null }), 'not-found')
      await expectStoreError(schedules.create({ sessionId: s1.id, title: 't', prompt: 'p', rule, nextAt: null, status: 'x' as never }), 'invalid-input')
      expect(await schedules.list({ sessionId: s2.id })).toEqual([])
    })

    it('定时任务 recordFire：一个事务内更新 lastOccurrence / nextAt / status 并追加条目，revision 不变', async () => {
      const { sessions, schedules } = await open()
      const w = await sessions.registerWorkspace({ path: '/w' })
      const s = await sessions.createSession({ workspaceId: w.id })
      const a = await schedules.create({ sessionId: s.id, title: 't', prompt: 'p', rule: { kind: 'at' }, nextAt: 2_000 })
      tick()
      const fired = await schedules.recordFire(a.id, { occurrence: 2_000, nextAt: null, status: 'inactive' }, { kind: 'note', payload: { fired: 2_000 } })
      expect(fired.schedule).toMatchObject({ lastOccurrence: 2_000, nextAt: null, status: 'inactive', revision: 1, updatedAt: 1_010 })
      expect(fired.entry).toMatchObject({ sessionId: s.id, seq: 1, kind: 'note', payload: { fired: 2_000 } })
      expect((await schedules.list())[0]).toEqual(fired.schedule)
      expect((await sessions.listEntries(s.id)).map((e) => e.payload)).toEqual([{ fired: 2_000 }])
      // 不给 status 时保持原状态。
      const b = await schedules.create({ sessionId: s.id, title: 'b', prompt: 'p', rule: { kind: 'every' }, nextAt: 1_000, status: 'paused' })
      expect((await schedules.recordFire(b.id, { occurrence: 1_000, nextAt: 61_000 }, { kind: 'note', payload: {} })).schedule).toMatchObject({
        status: 'paused',
        nextAt: 61_000,
        lastOccurrence: 1_000,
      })
      await expectStoreError(schedules.recordFire('missing', { occurrence: 1, nextAt: null }, { kind: 'note', payload: {} }), 'not-found')
    })

    it('定时任务 recordFire：条目不合 schema（事务中途抛错）时表行与条目都不变', async () => {
      const { sessions, schedules } = await open()
      const w = await sessions.registerWorkspace({ path: '/w' })
      const s = await sessions.createSession({ workspaceId: w.id })
      const a = await schedules.create({ sessionId: s.id, title: 't', prompt: 'p', rule: { kind: 'every' }, nextAt: 2_000 })
      await sessions.appendEntries(s.id, [{ kind: 'note', payload: { before: true } }])
      tick()
      await expectStoreError(
        schedules.recordFire(a.id, { occurrence: 2_000, nextAt: 62_000, status: 'inactive' }, { kind: 'doc', payload: { body: '' } }),
        'invalid-payload',
      )
      await expectStoreError(schedules.recordFire(a.id, { occurrence: 2_000, nextAt: 62_000 }, { kind: 'unregistered', payload: {} }), 'invalid-payload')
      expect((await schedules.list())[0]).toEqual(a)
      expect((await sessions.listEntries(s.id)).map((e) => e.payload)).toEqual([{ before: true }])
      expect((await schedules.due(2_000)).map((x) => x.id)).toEqual([a.id])
    })

    it('子进程登记接受 M5 的 hook 与 git、M6 的 lsp 类别', async () => {
      const { processes } = await open()
      await processes.register({ id: 'h', pid: 5, pgid: 5, startedAt: 'x', kind: 'hook', sessionId: 's', command: 'check.sh' })
      await processes.register({ id: 'g', pid: 6, startedAt: 'y', kind: 'git', command: 'git worktree add' })
      await processes.register({ id: 'l', pid: 7, pgid: 7, startedAt: 'z', kind: 'lsp', command: 'typescript-language-server --stdio' })
      expect((await processes.list()).map((p) => [p.id, p.kind])).toEqual([
        ['h', 'hook'],
        ['g', 'git'],
        ['l', 'lsp'],
      ])
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
        store.processes.list(),
        store.worktrees.list('w'),
        store.schedules.list(),
        store.sessions.listChildren('s'),
        store.plugins.list(),
        store.memories.search('x'),
      ]) {
        await expect(attempt).rejects.toMatchObject({ name: 'StoreError', code: 'closed' })
      }
    })
  })
}
