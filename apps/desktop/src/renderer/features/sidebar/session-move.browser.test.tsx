import '../../styles.css'
import { afterEach, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { Toaster, TooltipProvider, toast } from '@coko/ui'
import { ChatStoreProvider } from '../../app/chat.tsx'
import { I18nProvider } from '../../app/i18n.tsx'
import { createFixtureChat, fixtureSessions } from '../../testing/fixture-chat.ts'
import { ProjectDialogsProvider } from '../projects/project-dialogs.tsx'
import { WorkbenchNavigationContext } from '../../app/workbench.tsx'
import { createWorkbenchNavigation } from '../../app/workbench-navigation.ts'
import { projectApi } from '../../client/api.ts'
import { SidebarLists } from './sidebar-lists.tsx'

afterEach(() => {
  vi.restoreAllMocks()
  toast.dismiss()
})

async function setup(projectId: string | null = null, pinnedAt: number | null = null) {
  await page.viewport(1000, 800)
  const source = { ...fixtureSessions[0]!, title: 'Move source', projectId, pinnedAt }
  const fixture = createFixtureChat({ sessions: [source] })
  await fixture.chat.getState().load()
  await render(
    <I18nProvider locale="en">
      <ChatStoreProvider store={fixture.chat}>
        <WorkbenchNavigationContext.Provider value={createWorkbenchNavigation(fixture.chat)}>
          <ProjectDialogsProvider pickDirectory={async () => '/work/new'}>
            <TooltipProvider>
              <div style={{ width: 280 }}>
                <SidebarLists search={null} onAddWorkspace={() => {}} onNewSession={() => {}} onSelect={() => {}} />
              </div>
              <Toaster containerAriaLabel="Notifications" />
            </TooltipProvider>
          </ProjectDialogsProvider>
        </WorkbenchNavigationContext.Provider>
      </ChatStoreProvider>
    </I18nProvider>,
  )
  return { ...fixture, source }
}
async function openMove() {
  await userEvent.hover(page.getByRole('button', { name: 'Move source', exact: true }))
  await page.getByRole('button', { name: 'More conversation actions' }).click()
  const trigger = page.getByRole('menuitem', { name: 'Move to project', exact: true })
  await trigger.click()
  await expect.element(page.getByRole('textbox', { name: 'Search projects' })).toBeVisible()
  return trigger
}
it('submenu preserves its parent, touches the trigger, closes one level and moves only ownership', async () => {
  const fixture = await setup(null, 12)
  const trigger = await openMove()
  const parent = page.getByRole('menu', { name: 'Conversation actions' })
  const submenu = page.getByRole('menu', { name: 'Move to project', exact: true })
  await expect.element(parent).toBeVisible()
  // Floating UI rounds coordinates to device pixels.
  await expect.poll(() => Math.abs(submenu.element().getBoundingClientRect().left - trigger.element().getBoundingClientRect().right)).toBeLessThan(0.5)
  expect(Math.abs(submenu.element().getBoundingClientRect().top - trigger.element().getBoundingClientRect().top)).toBeLessThan(0.5)
  expect(parent.element().getBoundingClientRect().right - submenu.element().getBoundingClientRect().left).toBeCloseTo(4, 0)
  expect(Number(getComputedStyle(submenu.element()).zIndex)).toBeGreaterThan(Number(getComputedStyle(parent.element()).zIndex))
  expect(trigger.element().querySelector('svg:last-child')).not.toBeNull()
  await userEvent.keyboard('{Escape}')
  await expect.element(submenu).not.toBeInTheDocument()
  await expect.element(parent).toBeVisible()
  await expect.element(trigger).toHaveFocus()
  await trigger.click()
  await page.getByRole('menuitemradio', { name: 'pi', exact: true }).click()
  await expect.element(parent).not.toBeInTheDocument()
  expect(fixture.chat.lists.getState().sessions).toEqual([{ ...fixture.source, projectId: 'project-w-pi' }])
  expect(document.querySelectorAll(`[data-session-id="${fixture.source.id}"]`)).toHaveLength(1)
})

it.each([
  [null, null],
  ['project-w-coko', null],
  [null, 12],
  ['project-w-coko', 12],
] as const)('move out visibility follows actual ownership %s/%s and keeps pin/activity', async (projectId, pinnedAt) => {
  const fixture = await setup(projectId, pinnedAt)
  await openMove()
  const moveOut = page.getByRole('menuitem', { name: 'Move out of project', exact: true })
  expect(moveOut.query() !== null).toBe(projectId !== null)
  if (projectId === null) await userEvent.keyboard('{Escape}{Escape}')
  else await moveOut.click()
  expect(fixture.chat.lists.getState().sessions).toEqual([{ ...fixture.source, projectId: null }])
  expect(document.querySelectorAll(`[data-session-id="${fixture.source.id}"]`)).toHaveLength(1)
})
it('search matches only project names, duplicate names show primary folders and current target is checked', async () => {
  const fixture = await setup('project-w-coko')
  fixture.chat.lists.setState((state) => ({ projects: state.projects.map((project) => ({ ...project, name: 'web' })) }))
  await openMove()
  await expect.element(page.getByRole('menuitemradio', { name: 'web · coko', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect.element(page.getByRole('menuitemradio', { name: 'web · pi', exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Search projects' }).fill('coko')
  await expect.element(page.getByText('No matching projects', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Search projects' }).fill('WEB')
  await expect.element(page.getByRole('menuitemradio', { name: 'web · pi', exact: true })).toBeVisible()
  await userEvent.keyboard('{Escape}{Escape}')
})
async function folderForm(status: 'created' | 'existing' = 'created') {
  const fixture = await setup(null, 12)
  const target = { ...fixture.chat.lists.getState().projects[1]!, id: status === 'existing' ? 'project-w-pi' : 'new-project', name: 'Target project' }
  vi.spyOn(projectApi, 'checkFolder').mockResolvedValue({ path: '/work/new' })
  const create = vi.spyOn(projectApi, 'create').mockResolvedValue({ status, project: target })
  await openMove()
  await page.getByRole('menuitem', { name: 'Choose folder…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create project', exact: true })
  await expect.element(dialog).toBeVisible()
  await expect.element(page.getByRole('menu', { name: 'Conversation actions' })).not.toBeInTheDocument()
  return { ...fixture, target, create, dialog }
}
async function submitFolder(fixture: Awaited<ReturnType<typeof folderForm>>) {
  await fixture.dialog.getByRole('textbox', { name: 'Project name' }).fill('Target project')
  await fixture.dialog.getByRole('button', { name: /Add folder/ }).click()
  // Changing selection cannot redirect completion away from the captured source.
  fixture.chat.setState({ activeSessionId: null })
  await fixture.dialog.getByRole('button', { name: 'Create project', exact: true }).click()
}
it.each(['created', 'existing'] as const)('folder %s moves the pinned source with no new Session or navigation', async (status) => {
  const fixture = await folderForm(status)
  await submitFolder(fixture)
  await expect.element(fixture.dialog).not.toBeInTheDocument()
  await expect.poll(() => fixture.chat.lists.getState().sessions[0]?.projectId).toBe(fixture.target.id)
  expect(fixture.chat.lists.getState().sessions).toEqual([{ ...fixture.source, projectId: fixture.target.id }])
  expect(fixture.chat.newChat.getState().projectId).toBeNull()
  expect(fixture.chat.getState().activeSessionId).toBeNull()
  toast.dismiss()
  await expect.poll(() => document.querySelector('[data-sonner-toast]')).toBeNull()
})
it('a created project with failed move explicitly retains original ownership', async () => {
  const fixture = await folderForm()
  fixture.api.moveSession = async () => {
    throw new Error('move failed')
  }
  await submitFolder(fixture)
  await expect.element(fixture.dialog).not.toBeInTheDocument()
  await expect
    .element(page.getByText('Project created, but the conversation could not be moved. Its original project is unchanged.', { exact: true }))
    .toBeVisible()
  expect(fixture.chat.lists.getState().sessions).toEqual([fixture.source])
  expect(fixture.chat.lists.getState().projects).toContainEqual(fixture.target)
  expect(fixture.chat.newChat.getState().projectId).toBeNull()
  expect(fixture.chat.getState().activeSessionId).toBeNull()
  toast.dismiss()
  await expect.poll(() => document.querySelector('[data-sonner-toast]')).toBeNull()
})
it('failed project creation retains form and original ownership', async () => {
  const fixture = await folderForm()
  fixture.create.mockRejectedValue(new Error('network failure'))
  await submitFolder(fixture)
  await expect.element(fixture.dialog.getByRole('alert')).toHaveTextContent('Could not save the project. Try again.')
  expect(fixture.chat.lists.getState().sessions).toEqual([fixture.source])
  await fixture.dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click()
  expect(fixture.chat.newChat.getState().projectId).toBeNull()
})
it('cancelling folder creation preserves pinned source identity, ownership and current selection', async () => {
  const fixture = await folderForm()
  const active = fixture.chat.getState().activeSessionId
  await fixture.dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.element(fixture.dialog).not.toBeInTheDocument()
  expect(fixture.chat.lists.getState().sessions).toEqual([fixture.source])
  expect(fixture.chat.getState().activeSessionId).toBe(active)
})

it.each(['light', 'dark'])('%s submenu search keeps keyboard access, flips only at the edge and remains inside a narrow window', async (theme) => {
  const original = document.documentElement.className
  document.documentElement.classList.toggle('dark', theme === 'dark')
  try {
    await setup('project-w-coko')
    await openMove()
    await page.screenshot({ path: `../../../../../../.vitest/cw16-${theme}.png` })
    await userEvent.keyboard('{Escape}{Escape}')
    await page.viewport(390, 440)
    const row = page.getByRole('button', { name: 'Move source', exact: true })
    row.element().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 330, clientY: 130, button: 2 }))
    await page.getByRole('menuitem', { name: 'Move to project', exact: true }).click()
    const submenu = page.getByRole('menu', { name: 'Move to project', exact: true })
    await expect.element(submenu).toBeVisible()
    await expect.poll(() => submenu.element().getBoundingClientRect().right).toBeLessThanOrEqual(382)
    expect(submenu.element().getBoundingClientRect().left).toBeGreaterThanOrEqual(8)
    expect(submenu.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(432)
    await page.getByRole('textbox', { name: 'Search projects' }).fill('pi')
    await userEvent.keyboard('{ArrowDown}')
    await expect.element(page.getByRole('menuitemradio', { name: 'pi', exact: true })).toHaveFocus()
    await page.screenshot({ path: `../../../../../../.vitest/cw16-${theme}-390.png` })
    await userEvent.keyboard('{Escape}{Escape}')
  } finally {
    document.documentElement.className = original
  }
})
it('direct move failures retain the original ownership and allow retry', async () => {
  const fixture = await setup('project-w-coko', 12)
  const move = fixture.api.moveSession
  fixture.api.moveSession = async () => {
    throw new Error('network failure')
  }
  await openMove()
  await page.getByRole('menuitemradio', { name: 'pi', exact: true }).click()
  await expect.element(page.getByText('Could not move conversation. Try again.', { exact: true })).toBeVisible()
  expect(fixture.chat.lists.getState().sessions).toEqual([fixture.source])
  fixture.api.moveSession = move
  await openMove()
  await page.getByRole('menuitemradio', { name: 'pi', exact: true }).click()
  await expect.poll(() => fixture.chat.lists.getState().sessions[0]?.projectId).toBe('project-w-pi')
  toast.dismiss()
  await expect.poll(() => document.querySelector('[data-sonner-toast]')).toBeNull()
})
