import { afterEach, expect, it } from 'vitest'
import { conversationViewStore, forgetConversationViews, selectConversationView } from './view-store.ts'

afterEach(() => conversationViewStore.setState({ sessions: {} }))

it('keeps each Session view and lazily opened trajectory independent', () => {
  selectConversationView('one', 'trajectory')
  selectConversationView('two', 'conversation')
  expect(conversationViewStore.getState().sessions).toEqual({
    one: { active: 'trajectory', trajectoryOpened: true },
    two: { active: 'conversation', trajectoryOpened: false },
  })
  selectConversationView('one', 'conversation')
  expect(conversationViewStore.getState().sessions.one).toEqual({ active: 'conversation', trajectoryOpened: true })
})

it('clears only the permanently deleted Session views', () => {
  selectConversationView('one', 'trajectory')
  selectConversationView('two', 'trajectory')
  forgetConversationViews(['one', 'child'])
  expect(conversationViewStore.getState().sessions).toEqual({ two: { active: 'trajectory', trajectoryOpened: true } })
})
