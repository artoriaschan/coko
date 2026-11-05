import '../styles/theme.css'
import { expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { PanelTabs } from './panel-tabs.tsx'
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
