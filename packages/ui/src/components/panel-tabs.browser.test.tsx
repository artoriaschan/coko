import '../styles/theme.css'
import { expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { PanelStart, PanelTabs } from './panel-tabs.tsx'
import { TooltipProvider } from './tooltip.tsx'

it('truncated tab titles expose their full text on hover and keyboard focus', async () => {
  const title = 'A very long sidebar page title that needs its complete tooltip'
  await render(
    <TooltipProvider>
      <div style={{ width: 250 }}>
        <PanelTabs
          tabs={[{ id: 'long', title, icon: null, closeLabel: 'Close long tab' }]}
          active="long"
          label="Sidebar"
          newTabLabel="New tab"
          reorderHint="Reorder tab"
          menuLabels={{ close: 'Close', closeOthers: 'Close others', closeRight: 'Close right' }}
          dragLabels={{ instructions: 'Reorder tab', start: 'Dragging', over: (value) => value, end: 'Dropped', cancel: 'Cancelled' }}
          onSelect={() => {}}
          onClose={() => {}}
          onMove={() => {}}
          onCloseOthers={() => {}}
          onCloseRight={() => {}}
          controls={<button>Collapse</button>}
        />
      </div>
    </TooltipProvider>,
  )
  const tab = page.getByRole('tab', { name: title, exact: true })
  const text = tab.element().querySelector('span')!
  expect(text.scrollWidth).toBeGreaterThan(text.clientWidth)
  expect(getComputedStyle(text).textOverflow).toBe('ellipsis')
  await userEvent.hover(tab)
  await expect.element(page.getByRole('tooltip', { name: title, exact: true })).toBeVisible()
  await userEvent.unhover(tab)
  ;(tab.element() as HTMLElement).focus()
  await expect.element(page.getByRole('tooltip', { name: title, exact: true })).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('tooltip')).not.toBeInTheDocument()
})

it('Start entries are named by their title, describe themselves up to four pages and drop every description beyond that', async () => {
  const pages = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      id: `page-${index}`,
      title: `Page ${index}`,
      description: index === 1 ? undefined : `About page ${index}`,
      icon: <svg data-icon />,
    }))
  const Start = ({ count }: { count: number }) => (
    <div style={{ display: 'flex', height: 600 }}>
      <PanelStart pages={pages(count)} onOpen={() => {}} />
    </div>
  )
  const screen = await render(<Start count={4} />)
  const iconSize = (name: string) => page.getByRole('button', { name, exact: true }).element().querySelector('[data-icon]')!.getBoundingClientRect().width
  const described = page.getByRole('button', { name: 'Page 0', exact: true })
  await expect.element(described).toHaveAccessibleDescription('About page 0')
  await expect.element(page.getByText('About page 3', { exact: true })).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'Page 1', exact: true })).toHaveAccessibleDescription('')
  expect(iconSize('Page 0')).toBe(26)
  expect(iconSize('Page 1')).toBe(22)
  expect(described.element().getBoundingClientRect().height).toBeGreaterThan(
    page.getByRole('button', { name: 'Page 1', exact: true }).element().getBoundingClientRect().height,
  )
  await screen.rerender(<Start count={5} />)
  await expect.element(page.getByRole('button', { name: 'Page 4', exact: true })).toBeVisible()
  await expect.element(page.getByText('About page 0', { exact: true })).not.toBeInTheDocument()
  await expect.element(described).toHaveAccessibleDescription('')
  expect(iconSize('Page 0')).toBe(22)
})
