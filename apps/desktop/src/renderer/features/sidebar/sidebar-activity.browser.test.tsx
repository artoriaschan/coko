import '../../styles.css'
import { expect, it, onTestFinished } from 'vitest'
import { cdp, page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { createFixtureChat, fixtureSessions } from '../../testing/fixture-chat.ts'

it.each(['light', 'dark'] as const)('%s: running Session yields its indicator to hover, focus and menus without changing order', async (theme) => {
  await page.viewport(1200, 900)
  onTestFinished(() => document.documentElement.classList.remove('dark'))
  const fixture = createFixtureChat({
    sessions: [
      { ...fixtureSessions[0]!, id: 'recent', title: 'Recent idle', updatedAt: 20, running: false },
      {
        ...fixtureSessions[0]!,
        id: 'earlier',
        title: 'Earlier running with a long title that must keep clear of the activity and controls',
        updatedAt: 10,
        running: true,
      },
    ],
  })
  const appearance = createAppearanceStore({ theme, locale: 'en' })
  await render(
    <div style={{ width: '100vw', height: '100vh' }}>
      <App
        store={appearance}
        connection={createConnectionStore()}
        chat={fixture.chat}
        settings={fixture.settings}
        preferences={createPreferences({ appearance, settings: fixture.settings, onConflict: () => {}, onFailure: () => {} })}
        settingsPage={createSettingsPageStore()}
        pickDirectory={async () => null}
      />
    </div>,
  )
  await userEvent.hover(page.getByRole('heading', { name: 'Projects', exact: true }))
  const indicator = page.getByRole('img', { name: 'Running', exact: true })
  await expect.element(indicator).toBeVisible()
  const row = document.querySelector<HTMLButtonElement>('[data-session-id="earlier"]')!
  const icon = indicator.element()
  expect(getComputedStyle(icon).width).toBe('12px')
  expect(getComputedStyle(icon).height).toBe('12px')
  expect(icon.parentElement!.getBoundingClientRect().right).toBeLessThanOrEqual(row.getBoundingClientRect().right - 8)
  const title = row.querySelector<HTMLElement>('[data-scrollable-title]')!
  expect(title.getBoundingClientRect().right).toBeLessThanOrEqual(icon.parentElement!.getBoundingClientRect().left)
  expect([...document.querySelectorAll<HTMLElement>('[data-session-id]')].map((row) => row.dataset.sessionId)).toEqual(['recent', 'earlier'])
  await userEvent.hover(page.getByRole('button', { name: row.getAttribute('aria-label')!, exact: true }))
  await expect.element(icon).not.toBeVisible()
  const actions = row.parentElement!.querySelector<HTMLElement>('[data-session-actions]')!
  await expect.poll(() => getComputedStyle(actions).opacity).toBe('1')
  row.focus()
  await userEvent.hover(page.getByRole('heading', { name: 'Projects', exact: true }))
  await expect.element(icon).not.toBeVisible()
  await userEvent.keyboard('{Tab}{Tab}{Enter}')
  const menu = page.getByRole('menu', { name: 'Conversation actions' })
  await expect.element(menu).toBeVisible()
  await expect.element(icon).not.toBeVisible()
  expect(getComputedStyle(actions).opacity).toBe('1')
  await userEvent.keyboard('{Escape}')
  await expect.element(menu).not.toBeInTheDocument()
  ;(document.activeElement as HTMLElement)?.blur()
  await expect.element(indicator).toBeVisible()
})

it('collapsed Projects aggregate unpinned members, including pinned Projects, and hand activity back to expanded rows', async () => {
  await page.viewport(1200, 900)
  const fixture = createFixtureChat({
    sessions: [
      { ...fixtureSessions[0]!, id: 'idle', title: 'Idle member', running: false },
      { ...fixtureSessions[0]!, id: 'busy', title: 'Running member', running: true },
      { ...fixtureSessions[0]!, id: 'pin', title: 'Pinned running member', running: true, pinnedAt: 1, projectId: 'project-w-pi' },
    ],
  })
  const appearance = createAppearanceStore({ theme: 'light', locale: 'en' })
  await render(
    <div style={{ width: '100vw', height: '100vh' }}>
      <App
        store={appearance}
        connection={createConnectionStore()}
        chat={fixture.chat}
        settings={fixture.settings}
        preferences={createPreferences({ appearance, settings: fixture.settings, onConflict: () => {}, onFailure: () => {} })}
        settingsPage={createSettingsPageStore()}
        pickDirectory={async () => null}
      />
    </div>,
  )
  await expect.element(page.getByRole('button', { name: 'Running member', exact: true })).toBeVisible()
  const projects = page.getByRole('region', { name: 'Projects', exact: true })
  await projects.getByRole('button', { name: 'coko', exact: true }).click()
  await projects.getByRole('button', { name: 'pi', exact: true }).click()
  ;(document.activeElement as HTMLElement)?.blur()
  await userEvent.hover(page.getByRole('heading', { name: 'Projects', exact: true }))
  await expect.element(projects.getByRole('img', { name: 'Running', exact: true })).toBeVisible()
  const cokoRow = projects.getByRole('button', { name: 'coko', exact: true }).element().parentElement!
  const piRow = projects.getByRole('button', { name: 'pi', exact: true }).element().parentElement!
  expect(cokoRow.querySelector('[data-sidebar-activity]')).not.toBeNull()
  expect(piRow.querySelector('[data-sidebar-activity]')).toBeNull()
  await expect.element(page.getByRole('region', { name: 'Pinned', exact: true }).getByRole('img', { name: 'Running', exact: true })).toBeVisible()
  await projects.getByRole('button', { name: 'coko', exact: true }).click()
  expect(cokoRow.querySelector('[data-sidebar-activity]')).toBeNull()
  await expect.element(page.getByRole('button', { name: 'Running member', exact: true })).toBeVisible()
  await userEvent.hover(projects.getByRole('button', { name: 'coko', exact: true }))
  await projects.getByRole('button', { name: 'More project actions' }).first().click()
  await page.getByRole('menuitem', { name: 'Pin project', exact: true }).click()
  const pinned = page.getByRole('region', { name: 'Pinned', exact: true })
  await pinned.getByRole('button', { name: 'coko', exact: true }).click()
  ;(document.activeElement as HTMLElement)?.blur()
  await userEvent.hover(page.getByRole('heading', { name: 'Projects', exact: true }))
  expect(pinned.getByRole('img', { name: 'Running', exact: true }).all()).toHaveLength(2)
  const project = pinned.getByRole('button', { name: 'coko', exact: true }).element() as HTMLButtonElement
  project.focus()
  expect(getComputedStyle(project.parentElement!.querySelector('[data-sidebar-activity]')!).visibility).toBe('hidden')
  await expect.poll(() => getComputedStyle(project.parentElement!.querySelector('[data-project-actions]')!).opacity).toBe('1')
})

it('reduced motion stops spinning and devices without hover keep commands visible instead', async () => {
  await page.viewport(1200, 900)
  const client = cdp()
  onTestFinished(async () => {
    await client.send('Emulation.setEmulatedMedia', { features: [] })
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: false })
  })
  const fixture = createFixtureChat({
    sessions: [
      { ...fixtureSessions[0]!, id: 'idle', title: 'Idle', running: false },
      { ...fixtureSessions[0]!, id: 'busy', title: 'Busy', running: true },
    ],
  })
  const appearance = createAppearanceStore({ theme: 'light', locale: 'en' })
  await render(
    <div style={{ width: '100vw', height: '100vh' }}>
      <App
        store={appearance}
        connection={createConnectionStore()}
        chat={fixture.chat}
        settings={fixture.settings}
        preferences={createPreferences({ appearance, settings: fixture.settings, onConflict: () => {}, onFailure: () => {} })}
        settingsPage={createSettingsPageStore()}
        pickDirectory={async () => null}
      />
    </div>,
  )
  await userEvent.hover(page.getByRole('heading', { name: 'Projects', exact: true }))
  const icon = page.getByRole('img', { name: 'Running', exact: true })
  await expect.element(icon).toBeVisible()
  const element = icon.element()
  expect(getComputedStyle(element).animationName).not.toBe('none')
  await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await expect.poll(() => getComputedStyle(element).animationName).toBe('none')
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  await expect.poll(() => matchMedia('(hover: none)').matches).toBe(true)
  await expect.element(element).not.toBeVisible()
  const row = document.querySelector('[data-session-row="busy"]')!
  await expect.poll(() => getComputedStyle(row.querySelector('[data-session-actions]')!).opacity).toBe('1')
})

it('unopened Session broadcasts keep background activity visible and collapsed Projects use the right accessible name', async () => {
  await page.viewport(1200, 900)
  const fixture = createFixtureChat({ sessions: [{ ...fixtureSessions[0]!, id: 'background', title: 'Background member', running: false }] })
  const appearance = createAppearanceStore({ theme: 'light', locale: 'en' })
  await render(
    <div style={{ width: '100vw', height: '100vh' }}>
      <App
        store={appearance}
        connection={createConnectionStore()}
        chat={fixture.chat}
        settings={fixture.settings}
        preferences={createPreferences({ appearance, settings: fixture.settings, onConflict: () => {}, onFailure: () => {} })}
        settingsPage={createSettingsPageStore()}
        pickDirectory={async () => null}
      />
    </div>,
  )
  await userEvent.hover(page.getByRole('heading', { name: 'Projects', exact: true }))
  fixture.sendServer({ type: 'session_status', sessionId: 'background', running: false, agentsRunning: true })
  await expect.element(page.getByRole('img', { name: 'Running in background', exact: true })).toBeVisible()
  const projects = page.getByRole('region', { name: 'Projects', exact: true })
  await projects.getByRole('button', { name: 'coko', exact: true }).click()
  ;(document.activeElement as HTMLElement)?.blur()
  await userEvent.hover(page.getByRole('heading', { name: 'Projects', exact: true }))
  await expect.element(projects.getByRole('img', { name: 'Running in background', exact: true })).toBeVisible()
  fixture.sendServer({ type: 'session_status', sessionId: 'background', running: true, agentsRunning: true })
  await expect.element(projects.getByRole('img', { name: 'Running', exact: true })).toBeVisible()
  fixture.sendServer({ type: 'session_status', sessionId: 'background', running: false, agentsRunning: false })
  await expect.element(projects.getByRole('img', { name: 'Running', exact: true })).not.toBeInTheDocument()
})
