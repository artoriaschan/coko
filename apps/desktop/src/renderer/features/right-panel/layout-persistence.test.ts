import { expect, it } from 'vitest'
import { parseRightPanelLayout } from './layout-persistence.ts'

it('filters unknown and disabled kinds, retains ordering and selects the first remaining page', () => {
  expect(parseRightPanelLayout({ tabs: ['future', 'jobs', 'plan'], active: 'future', expanded: true, mode: 'fullscreen' }, ['start', 'plan', 'jobs'])).toEqual({
    tabs: ['jobs', 'plan'],
    active: 'jobs',
    expanded: true,
    mode: 'fullscreen',
  })
  expect(parseRightPanelLayout({ tabs: ['team', 'plan'], active: 'team', expanded: false, mode: 'normal' }, ['start', 'plan'])).toEqual({
    tabs: ['plan'],
    active: 'plan',
    expanded: false,
    mode: 'normal',
  })
})

it.each([
  null,
  [],
  { tabs: 'plan', active: 'plan', expanded: true, mode: 'normal' },
  { tabs: ['plan'], active: 'trace', expanded: true, mode: 'normal' },
  { tabs: ['plan', 'plan'], active: 'plan', expanded: true, mode: 'normal' },
  { tabs: ['plan'], active: null, expanded: true, mode: 'normal' },
  { tabs: ['plan'], active: 'plan', expanded: 'yes', mode: 'normal' },
  { tabs: ['plan'], active: 'plan', expanded: true, mode: 'float' },
])('rejects malformed stored layout %#', (value) => {
  expect(parseRightPanelLayout(value)).toBeNull()
})

it('resets empty layouts and layouts whose pages have all become unavailable', () => {
  expect(parseRightPanelLayout({ tabs: [], active: null, expanded: false, mode: 'fullscreen' })).toEqual({
    tabs: [],
    active: null,
    expanded: false,
    mode: 'normal',
  })
  expect(parseRightPanelLayout({ tabs: ['future'], active: 'future', expanded: true, mode: 'fullscreen' })).toEqual({
    tabs: [],
    active: null,
    expanded: false,
    mode: 'normal',
  })
})

it('removes the retired sidebar trajectory page from old saved layouts', () => {
  expect(parseRightPanelLayout({ tabs: ['trace', 'plan'], active: 'trace', expanded: true, mode: 'fullscreen' })).toEqual({
    tabs: ['plan'],
    active: 'plan',
    expanded: true,
    mode: 'fullscreen',
  })
  expect(parseRightPanelLayout({ tabs: ['trace'], active: 'trace', expanded: true, mode: 'fullscreen' })).toEqual({
    tabs: [],
    active: null,
    expanded: false,
    mode: 'normal',
  })
})
