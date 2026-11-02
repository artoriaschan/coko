import { expect, it } from 'vitest'
import { createFixtureChat, fixtureSessions } from '../testing/fixture-chat.ts'

it('a list refresh started before deletion cannot resurrect a deleted conversation', async () => {
  const fixture = createFixtureChat()
  await fixture.chat.getState().load()
  const target = fixtureSessions[0]!
  let resolve!: (sessions: typeof fixtureSessions) => void
  fixture.api.listSessions = () =>
    new Promise((done) => {
      resolve = done
    })
  const loading = fixture.chat.lists.getState().load()
  await fixture.chat.getState().deleteSession(target.id)
  resolve(fixtureSessions)
  await loading
  expect(fixture.chat.lists.getState().sessions.some((session) => session.id === target.id)).toBe(false)
  expect(fixture.chat.getState().activeSessionId).toBeNull()
})

it('deleting a different conversation preserves the currently open conversation', async () => {
  const fixture = createFixtureChat()
  await fixture.chat.getState().load()
  const target = fixtureSessions[0]!
  const current = fixtureSessions[1]!
  fixture.chat.getState().openSession(current.id)
  await fixture.chat.getState().deleteSession(target.id)
  expect(fixture.chat.getState().activeSessionId).toBe(current.id)
  expect(fixture.chat.lists.getState().sessions.some((session) => session.id === target.id)).toBe(false)
  expect(fixture.chat.getState().conversations[current.id]).toBeDefined()
})
