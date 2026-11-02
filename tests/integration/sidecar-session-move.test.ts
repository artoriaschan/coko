import { expect, it, onTestFinished } from 'vitest'
import { API_ROUTES, apiPaths, worktreePaths } from '@coko/protocol'
import { createGitWorkspace } from '../fixtures/git/index.ts'
import { client, exchange, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

it('moving a pinned root session changes only ownership and survives restart; invalid targets preserve it', async () => {
  const dirs = await sidecarDirs()
  const first = await startSidecar({ dirs })
  const api = client(first, await exchange(first))
  const source = (await api.post(API_ROUTES.workspaces, { path: await tempDir(), name: 'Source' })).body
  const target = (await api.post(API_ROUTES.workspaces, { path: await tempDir(), name: 'Target' })).body
  const projects = (await api.get(API_ROUTES.projects)).body.projects
  const projectId = projects.find((project: { primaryWorkspaceId: string }) => project.primaryWorkspaceId === target.id).id
  const created = (await api.post(API_ROUTES.sessions, { workspaceId: source.id, title: 'Move me' })).body
  const session = (await api.put(`${apiPaths.session(created.id)}/pin`, { pinned: true })).body
  const move = `${apiPaths.session(session.id)}/project`
  expect((await api.put(move, { projectId })).status).toBe(200)
  const moved = (await api.get(apiPaths.session(session.id))).body.session
  expect(moved).toEqual({ ...session, projectId })
  expect((await api.put(move, { projectId: 'missing' })).status).toBe(404)
  expect((await api.put(move, { projectId: 12 })).status).toBe(400)
  expect((await api.get(apiPaths.session(session.id))).body.session).toEqual(moved)
  await first.stop()
  const second = await startSidecar({ dirs })
  const after = client(second, await exchange(second))
  expect((await after.get(apiPaths.session(session.id))).body.session).toEqual(moved)
  expect((await after.put(move, { projectId: null })).body).toEqual({ ...session, projectId: null })
  expect((await after.get(API_ROUTES.sessions)).body.sessions).toHaveLength(1)
})

it('moving a worktree session preserves its binding and message history', async () => {
  const repo = await createGitWorkspace()
  onTestFinished(() => repo.dispose())
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: repo.env })
  const api = client(sidecar, await exchange(sidecar))
  const source = (await api.post(API_ROUTES.workspaces, { path: repo.root })).body
  const target = (await api.post(API_ROUTES.workspaces, { path: await tempDir() })).body
  const projectId = (await api.get(API_ROUTES.projects)).body.projects.find(
    (project: { primaryWorkspaceId: string }) => project.primaryWorkspaceId === target.id,
  ).id
  const worktree = (await api.post(worktreePaths.workspaceWorktrees(source.id), { name: 'move-me' })).body
  const created = (await api.post(API_ROUTES.sessions, { workspaceId: source.id, worktreeId: worktree.id })).body
  const detail = (await api.get(apiPaths.session(created.id))).body
  const session = detail.session
  expect(session.worktree).toMatchObject({ id: worktree.id, name: worktree.name, branch: worktree.branch })
  expect((await api.put(`${apiPaths.session(session.id)}/project`, { projectId })).body).toEqual({ ...session, projectId })
  expect((await api.get(apiPaths.session(session.id))).body).toEqual({ ...detail, session: { ...session, projectId } })
  expect((await api.put(`${apiPaths.session(session.id)}/project`, { projectId: null })).body).toEqual({ ...session, projectId: null })
  expect((await api.get(worktreePaths.workspaceWorktrees(source.id))).body).toContainEqual({ ...worktree, sessionCount: 1 })
})
