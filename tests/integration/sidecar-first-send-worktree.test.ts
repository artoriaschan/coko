import { chmod, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { API_ROUTES, apiPaths, hookPaths, worktreePaths } from '@coko/protocol'
import { createGitWorkspace } from '../fixtures/git/index.ts'
import { client, exchange, fauxScript, pollUntil, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

it('CW-65: first send uses the selected branch latest commit in an automatic worktree, preserves source, and deduplicates after restart', async () => {
  const fixture = await createGitWorkspace()
  onTestFinished(() => fixture.dispose())
  await fixture.git('checkout', '-qb', 'feature')
  await writeFile(join(fixture.root, 'base.txt'), 'latest feature commit\n')
  await fixture.git('add', '-A')
  await fixture.git('commit', '-qm', 'latest feature')
  const latest = (await fixture.git('rev-parse', 'HEAD')).trim()
  await fixture.git('checkout', '-q', 'main')
  await writeFile(join(fixture.root, 'README.md'), 'source uncommitted work\n')
  const root = await tempDir()
  const dirs = await sidecarDirs()
  const env = {
    ...fixture.env,
    COKO_FAUX_SCRIPT: await fauxScript(root, {
      responses: [{ content: [{ type: 'toolCall', id: 'cwd', name: 'bash', arguments: { command: 'pwd -P > cwd.txt' } }] }, { content: 'Worktree ready.' }],
    }),
  }
  const sidecar = await startSidecar({ dirs, env })
  const api = client(sidecar, await exchange(sidecar))
  const workspace = (await api.post(API_ROUTES.workspaces, { path: fixture.root })).body
  const project = (await api.get(API_ROUTES.projects)).body.projects[0]
  const input = {
    draftId: 'worktree-first',
    projectId: project.id,
    newWorktree: true,
    baseBranch: 'feature',
    text: 'worktree task',
    permissionMode: 'full-access',
  }
  const [created, duplicate] = await Promise.all([api.post(API_ROUTES.firstSend, input), api.post(API_ROUTES.firstSend, input)])
  expect(created.status).toBe(201)
  const session = created.body.session
  expect(duplicate.body).toEqual(created.body)
  expect(session).toMatchObject({
    workspaceId: workspace.id,
    projectId: project.id,
    worktree: { name: expect.stringMatching(/^wt-[0-9a-f]{6}$/), branch: expect.stringMatching(/^coko\/wt-[0-9a-f]{6}$/) },
  })
  const [worktree] = (await api.get(worktreePaths.workspaceWorktrees(workspace.id))).body
  expect(worktree.baseCommit).toBe(latest)
  expect(await readFile(join(worktree.path, 'base.txt'), 'utf8')).toBe('latest feature commit\n')
  await pollUntil(async () => (await readFile(join(worktree.path, 'cwd.txt'), 'utf8').catch(() => '')).trim() === worktree.path, {
    what: 'worktree cwd',
    timeoutMs: 15_000,
  })
  expect(await readFile(join(fixture.root, 'README.md'), 'utf8')).toBe('source uncommitted work\n')
  expect((await fixture.git('branch', '--show-current')).trim()).toBe('main')
  const detail = (await api.get(apiPaths.session(session.id))).body
  expect(detail.entries.filter((entry: { kind: string }) => entry.kind === 'run_start')).toHaveLength(1)
  await sidecar.stop()
  const restarted = await startSidecar({ dirs, env })
  const after = client(restarted, await exchange(restarted))
  expect((await after.post(API_ROUTES.firstSend, input)).body.session.id).toBe(session.id)
  expect((await after.get(worktreePaths.workspaceWorktrees(workspace.id))).body).toHaveLength(1)
})

it('CW-65: rejected first sends remove unchanged worktrees and unmerged branches; missing base branch leaves no traces', async () => {
  const fixture = await createGitWorkspace()
  onTestFinished(() => fixture.dispose())
  await fixture.git('checkout', '-qb', 'feature')
  await writeFile(join(fixture.root, 'feature.txt'), 'unmerged\n')
  await fixture.git('add', '-A')
  await fixture.git('commit', '-qm', 'unmerged')
  await fixture.git('checkout', '-q', 'main')
  const root = await tempDir()
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { ...fixture.env, COKO_FAUX_SCRIPT: await fauxScript(root, { responses: [] }) } })
  const api = client(sidecar, await exchange(sidecar))
  const workspace = (await api.post(API_ROUTES.workspaces, { path: fixture.root })).body
  const project = (await api.get(API_ROUTES.projects)).body.projects[0]
  const input = { draftId: 'reject-worktree', projectId: project.id, newWorktree: true, baseBranch: 'feature', text: 'hello' }
  const before = await readFile(join(fixture.root, '.git/info/exclude'), 'utf8')
  expect((await api.post(API_ROUTES.firstSend, { ...input, baseBranch: 'missing' })).status).toBe(400)
  expect(await readdir(fixture.root)).not.toContain('.coko-worktrees')
  expect(await readFile(join(fixture.root, '.git/info/exclude'), 'utf8')).toBe(before)
  expect((await api.get(worktreePaths.workspaceWorktrees(workspace.id))).body).toHaveLength(0)
  await api.put(hookPaths.hooks, { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'exit 2' }] }] }, expectedRevision: 0 })
  const rejected = await api.post(API_ROUTES.firstSend, input)
  expect([rejected.status, rejected.body.error.code]).toEqual([400, 'hook-blocked'])
  expect((await api.get(API_ROUTES.sessions)).body.sessions).toHaveLength(0)
  expect(await readdir(join(fixture.root, '.coko-worktrees'))).toEqual([])
  expect((await fixture.git('branch', '--list', 'coko/*')).trim()).toBe('')
  expect((await fixture.git('worktree', 'list', '--porcelain')).match(/worktree /g)).toHaveLength(1)
  expect((await fixture.git('branch', '--show-current')).trim()).toBe('main')
  await api.put(hookPaths.hooks, { hooks: {}, expectedRevision: 1 })
  expect((await api.post(API_ROUTES.firstSend, { ...input, model: { providerId: 'missing', modelId: 'missing' } })).status).toBe(400)
  expect(await readdir(join(fixture.root, '.coko-worktrees'))).toEqual([])
  expect((await fixture.git('branch', '--list', 'coko/*')).trim()).toBe('')
  expect((await api.post(API_ROUTES.firstSend, input)).status).toBe(201)
  expect((await api.get(API_ROUTES.sessions)).body.sessions).toHaveLength(1)
  expect((await api.post(API_ROUTES.firstSend, { draftId: 'no-project', newWorktree: true, text: 'hello' })).status).toBe(400)
})

it('a rejecting Hook that changes its new worktree keeps those files and branch while removing the unaccepted Session', async () => {
  const fixture = await createGitWorkspace()
  onTestFinished(() => fixture.dispose())
  const root = await tempDir()
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { ...fixture.env, COKO_FAUX_SCRIPT: await fauxScript(root, { responses: [] }) } })
  const api = client(sidecar, await exchange(sidecar))
  const workspace = (await api.post(API_ROUTES.workspaces, { path: fixture.root })).body
  const project = (await api.get(API_ROUTES.projects)).body.projects[0]
  await api.put(hookPaths.hooks, {
    hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'printf changed > "$COKO_PROJECT_DIR/keep.txt"; exit 2' }] }] },
    expectedRevision: 0,
  })
  const response = await api.post(API_ROUTES.firstSend, { draftId: 'keep-changed', projectId: project.id, newWorktree: true, text: 'hello' })
  expect(response.body.error.code).toBe('hook-blocked')
  expect((await api.get(API_ROUTES.sessions)).body.sessions).toHaveLength(0)
  const [tree] = (await api.get(worktreePaths.workspaceWorktrees(workspace.id))).body
  expect(tree.status).toBe('active')
  expect(await readFile(join(tree.path, 'keep.txt'), 'utf8')).toBe('changed')
  expect(await fixture.git('branch', '--list', tree.branch)).toContain(tree.branch)
  expect(await fixture.git('status', '--porcelain')).toBe('')
})

it('a git post-checkout failure removes the checkout and branch created before git returned an error', async () => {
  const fixture = await createGitWorkspace()
  onTestFinished(() => fixture.dispose())
  const hook = join(fixture.root, '.git', 'hooks', 'post-checkout')
  await writeFile(hook, '#!/bin/sh\nexit 1\n')
  await chmod(hook, 0o755)
  const root = await tempDir()
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { ...fixture.env, COKO_FAUX_SCRIPT: await fauxScript(root, { responses: [] }) } })
  const api = client(sidecar, await exchange(sidecar))
  const workspace = (await api.post(API_ROUTES.workspaces, { path: fixture.root })).body
  const project = (await api.get(API_ROUTES.projects)).body.projects[0]
  expect(
    (await api.post(API_ROUTES.firstSend, { draftId: 'git-failure', projectId: project.id, newWorktree: true, text: 'hello' })).status,
  ).toBeGreaterThanOrEqual(400)
  expect((await api.get(API_ROUTES.sessions)).body.sessions).toHaveLength(0)
  expect((await api.get(worktreePaths.workspaceWorktrees(workspace.id))).body).toHaveLength(0)
  expect(await readdir(join(fixture.root, '.coko-worktrees'))).toEqual([])
  expect((await fixture.git('branch', '--list', 'coko/*')).trim()).toBe('')
})
