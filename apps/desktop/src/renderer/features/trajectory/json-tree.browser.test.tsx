import '../../styles.css'
import { expect, it, onTestFinished, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { JsonTree, type JsonTreeLabels } from './json-tree.tsx'

const labels: JsonTreeLabels = {
  copyValue: 'Copy value',
  copyJson: 'Copy JSON',
  copyPath: 'Copy path',
  copyPrettyJson: 'Copy pretty JSON',
  copyCompactJson: 'Copy compact JSON',
  copied: 'Copied',
  copyFailed: 'Copy failed',
  collapseNode: 'Collapse',
  expandNode: 'Expand',
  copyButtonTitle: (action) => action,
}

it('uses the Harness JSON tree keyboard navigation for nested objects and arrays', async () => {
  const view = await render(<JsonTree data={{ outer: { name: 'Coko', nested: [1, 2] }, other: [true, false] }} label="Recorded JSON" labels={labels} />)
  onTestFinished(() => view.unmount())
  const outer = page.getByRole('button', { name: 'Expand', exact: true }).first().element()
  outer.focus()
  await userEvent.keyboard('{ArrowRight}')
  await expect.poll(() => outer.getAttribute('aria-expanded')).toBe('true')
  await userEvent.keyboard('{ArrowDown}')
  const nested = document.activeElement
  expect(nested?.closest('[role="treeitem"]')?.textContent).toContain('nested:')
  await userEvent.keyboard('{ArrowRight}')
  expect(nested?.getAttribute('aria-expanded')).toBe('true')
  const group = document.getElementById(nested!.getAttribute('aria-controls')!)!
  expect(group.querySelectorAll('[role="treeitem"]')).toHaveLength(2)
  await userEvent.keyboard('{ArrowLeft}')
  expect(nested?.getAttribute('aria-expanded')).toBe('false')
  expect(document.contains(group)).toBe(false)
})

it('copies raw values and exposes JSON/path formats by right-click without opening a menu on normal copy', async () => {
  const copied = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
  onTestFinished(() => copied.mockRestore())
  const view = await render(<JsonTree data={{ name: 'Coko', options: { enabled: true } }} label="Recorded JSON" labels={labels} />)
  onTestFinished(() => view.unmount())
  const name = page.getByRole('treeitem', { name: /^name:/ })
  await name.hover()
  await page.getByRole('button', { name: 'Copy value', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Copy path', exact: true }).click()
  expect(copied).toHaveBeenLastCalledWith('$.name')
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  await name.hover()
  // A different target clears the transient Copied label before returning to this row.
  await page.getByRole('treeitem', { name: /^Expand options:/ }).hover()
  await name.hover()
  await page.getByRole('button', { name: 'Copy value', exact: true }).click()
  expect(copied).toHaveBeenLastCalledWith('Coko')
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
})

it('folds long strings and preserves the shared wrapping preference on the next expansion', async () => {
  let wrapped = false
  const text = Array.from({ length: 40 }, (_, index) => `Line ${index}: ${'full recorded content '.repeat(12)}`).join('\n')
  const view = await render(
    <div style={{ width: 380 }}>
      <JsonTree
        data={{ prompt: text }}
        label="Recorded JSON"
        labels={labels}
        collapsedStringLines={3}
        stringWrapping={{
          label: 'Wrap lines',
          getDefault: () => wrapped,
          setDefault: (next) => {
            wrapped = next
          },
        }}
      />
    </div>,
  )
  onTestFinished(() => view.unmount())
  await page.getByRole('button', { name: 'Expand', exact: true }).click()
  const wrap = page.getByRole('button', { name: 'Wrap lines', exact: true })
  await expect.element(wrap).toHaveAttribute('aria-pressed', 'false')
  await wrap.click()
  expect(wrapped).toBe(true)
  await page.getByRole('button', { name: 'Collapse', exact: true }).click()
  await page.getByRole('button', { name: 'Expand', exact: true }).click()
  await expect.element(page.getByRole('button', { name: 'Wrap lines', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

it('uses Harness menu keyboard traversal: Tab enters, arrows wrap, and Tab selects the focused copy format', async () => {
  const copied = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
  onTestFinished(() => copied.mockRestore())
  const view = await render(<JsonTree data={{ name: 'Coko' }} label="Recorded JSON" labels={labels} />)
  onTestFinished(() => view.unmount())
  await page.getByRole('treeitem', { name: /^name:/ }).hover()
  const trigger = page.getByRole('button', { name: 'Copy value', exact: true }).element()
  trigger.focus()
  await page.elementLocator(trigger).click({ button: 'right' })
  await expect.element(page.getByRole('menu')).toBeVisible()
  expect(document.activeElement).toBe(trigger)
  await userEvent.keyboard('{Tab}')
  await expect.element(page.getByRole('menuitem', { name: 'Copy value', exact: true })).toHaveFocus()
  await userEvent.keyboard('{ArrowUp}')
  await expect.element(page.getByRole('menuitem', { name: 'Copy path', exact: true })).toHaveFocus()
  await userEvent.keyboard('{Tab}')
  expect(copied).toHaveBeenCalledWith('$.name')
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
})
