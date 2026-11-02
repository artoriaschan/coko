import { expect, it } from 'vitest'
import { createWorkbenchNavigation } from '../app/workbench-navigation.ts'
import { createFixtureChat, fixtureSessions } from '../testing/fixture-chat.ts'

it('late list, pin and rename responses cannot restore archive metadata or erase a generated title', async () => {
  const fixture = createFixtureChat({ sessions: [{ ...fixtureSessions[0]!, pinnedAt: 1 }] })
  await fixture.chat.getState().load()
  let list!: (sessions: typeof fixtureSessions) => void
  fixture.api.listSessions = () =>
    new Promise((resolve) => {
      list = resolve
    })
  const loading = fixture.chat.lists.getState().load()
  let pin!: (session: (typeof fixtureSessions)[number]) => void
  fixture.api.setSessionPinned = () =>
    new Promise((resolve) => {
      pin = resolve
    })
  const pinning = fixture.chat.lists.getState().setPinned('s-1', true)
  let rename!: (session: (typeof fixtureSessions)[number]) => void
  fixture.api.renameSession = () =>
    new Promise((resolve) => {
      rename = resolve
    })
  const renaming = fixture.chat.lists.getState().renameSession('s-1', 'renamed')
  await fixture.chat.getState().archiveSession('s-1')
  fixture.sendServer({ type: 'session_title', sessionId: 's-1', title: 'generated title' })
  list([fixtureSessions[0]!])
  pin({ ...fixtureSessions[0]!, title: 'stale', pinnedAt: 123 })
  rename({ ...fixtureSessions[0]!, title: 'renamed', pinnedAt: 123 })
  await Promise.all([loading, pinning, renaming])
  expect(fixture.chat.lists.getState().sessions).toEqual([])
  expect(fixture.chat.lists.getState().archivedSessions[0]).toMatchObject({ id: 's-1', title: 'renamed', pinnedAt: null, archivedAt: expect.any(Number) })
  await fixture.chat.getState().restoreSession('s-1')
  expect(fixture.chat.lists.getState().sessions[0]).toMatchObject({ archivedAt: null, pinnedAt: null, title: 'renamed' })
})

it('a normal list snapshot started while archived cannot remove a conversation restored while it is in flight', async () => {
  const fixture = createFixtureChat({ sessions: [fixtureSessions[0]!] })
  await fixture.chat.getState().load()
  await fixture.chat.getState().archiveSession('s-1')
  let resolve!: (sessions: typeof fixtureSessions) => void
  fixture.api.listSessions = () =>
    new Promise((done) => {
      resolve = done
    })
  const loading = fixture.chat.lists.getState().load()
  await fixture.chat.getState().restoreSession('s-1')
  resolve([])
  await loading
  expect(fixture.chat.lists.getState().sessions).toEqual([expect.objectContaining({ id: 's-1', archivedAt: null, pinnedAt: null })])
})

it('a pin response requested before archive cannot repin after restore', async () => {
  const fixture = createFixtureChat({ sessions: [fixtureSessions[0]!] })
  await fixture.chat.getState().load()
  let resolve!: (session: (typeof fixtureSessions)[number]) => void
  fixture.api.setSessionPinned = () =>
    new Promise((done) => {
      resolve = done
    })
  const pinning = fixture.chat.lists.getState().setPinned('s-1', true)
  await fixture.chat.getState().archiveSession('s-1')
  await fixture.chat.getState().restoreSession('s-1')
  resolve({ ...fixtureSessions[0]!, pinnedAt: 123 })
  await pinning
  expect(fixture.chat.lists.getState().sessions[0]!.pinnedAt).toBeNull()
})

it('history skips archived conversations while an explicit Settings-style selection can still open them', async () => {
  const fixture = createFixtureChat({ sessions: [fixtureSessions[0]!, fixtureSessions[2]!] })
  await fixture.chat.getState().load()
  const navigation = createWorkbenchNavigation(fixture.chat)
  const disconnect = navigation.connect()
  navigation.openSession('s-3')
  await fixture.chat.getState().archiveSession('s-1')
  expect(navigation.getSnapshot().canBack).toBe(false)
  fixture.chat.getState().openSession('s-1')
  expect(navigation.getSnapshot().location).toEqual({ kind: 'session', sessionId: 's-1' })
  navigation.back()
  expect(fixture.chat.getState().activeSessionId).toBe('s-3')
  expect(navigation.getSnapshot().canForward).toBe(false)
  disconnect()
})

it('an archived-list snapshot cannot overwrite a newer title notification', async () => {
  const fixture = createFixtureChat({ sessions: [fixtureSessions[0]!] })
  await fixture.chat.getState().load()
  await fixture.chat.getState().archiveSession('s-1')
  const stale = [...fixture.chat.lists.getState().archivedSessions]
  let resolve!: (sessions: typeof fixtureSessions) => void
  fixture.api.listArchivedSessions = () =>
    new Promise((done) => {
      resolve = done
    })
  const loading = fixture.chat.lists.getState().loadArchived()
  fixture.sendServer({ type: 'session_title', sessionId: 's-1', title: 'newer title' })
  resolve(stale)
  await loading
  expect(fixture.chat.lists.getState().archivedSessions[0]!.title).toBe('newer title')
})
