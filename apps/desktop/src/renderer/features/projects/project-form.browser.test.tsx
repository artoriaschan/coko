import '../../styles.css'
import { expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { I18nProvider } from '../../app/i18n.tsx'
import { ProjectFormDialog } from './project-form.tsx'
import { applyTheme } from '@coko/ui'
import { ApiError } from '../../client/api.ts'

it('CW-11/12/67/68：空状态、唯一主要、重复与取消选择、放弃确认保留输入', async () => {
  await page.viewport(1000, 800)
  const picks: (string | null)[] = ['/work/one', '/work/two', '/work/two', null]
  let closed = false
  const view = await render(
    <I18nProvider locale="zh">
      <ProjectFormDialog
        mode="create"
        onClose={() => {
          closed = true
        }}
        pickDirectory={async () => picks.shift() ?? null}
        checkFolder={async (path) => ({ path })}
        onSubmit={async () => {
          throw new Error('unavailable')
        }}
        onComplete={() => {}}
      />
    </I18nProvider>,
  )
  const name = page.getByRole('textbox', { name: '项目名称' })
  await expect.element(name).toHaveFocus()
  await expect.element(page.getByRole('button', { name: '创建项目', exact: true })).toBeDisabled()
  const empty = document.querySelector<HTMLElement>('[data-project-form]')!
  await expect.poll(() => empty.getBoundingClientRect().width).toBe(520)
  expect(empty.getBoundingClientRect().height).toBe(360)
  await page.screenshot({ element: empty, path: '../../../../../../.vitest/cw13-light-empty.png' })
  await name.fill('项目一')
  await page.getByRole('button', { name: /添加文件夹/ }).click()
  await expect.element(page.getByText('/work/one', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '添加文件夹', exact: true }).click()
  await expect.element(page.getByText('主要', { exact: true })).toBeVisible()
  const second = document.querySelector<HTMLElement>('[data-project-folder="/work/two"]')!
  const primaryButton = second.querySelector<HTMLButtonElement>('[data-make-primary]')!
  await userEvent.hover(name)
  await expect.poll(() => getComputedStyle(primaryButton).opacity).toBe('0')
  const before = second.querySelector('[data-folder-copy]')!.getBoundingClientRect()
  await userEvent.hover(page.getByText('/work/two', { exact: true }))
  await expect.poll(() => getComputedStyle(primaryButton).opacity).toBe('1')
  expect(second.querySelector('[data-folder-copy]')!.getBoundingClientRect().x).toBe(before.x)
  await page.getByRole('button', { name: '设为主要', exact: true }).click()
  expect(second.textContent).toContain('主要')
  expect(document.querySelectorAll('[data-primary-folder="true"]')).toHaveLength(1)
  await page.getByRole('button', { name: '添加文件夹', exact: true }).click()
  await expect.element(page.getByRole('status').filter({ hasText: '已添加' })).toBeVisible()
  await page.getByRole('button', { name: '添加文件夹', exact: true }).click()
  expect(document.querySelectorAll('[data-project-folder]')).toHaveLength(2)
  await page.getByRole('button', { name: '创建项目', exact: true }).click()
  await expect.element(page.getByRole('alert')).toHaveTextContent('未能保存项目，请重试')
  await expect.element(name).toHaveValue('项目一')
  await page.getByRole('button', { name: '移除 two', exact: true }).click()
  expect(document.querySelector('[data-project-folder="/work/one"]')?.getAttribute('data-primary-folder')).toBe('true')
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('alertdialog', { name: '放弃更改？' })).toBeVisible()
  await page.getByRole('button', { name: '继续编辑' }).click()
  await expect.element(name).toHaveValue('项目一')
  await page.getByRole('button', { name: '关闭对话框' }).click()
  await expect.element(page.getByRole('alertdialog', { name: '放弃更改？' })).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(name).toHaveValue('项目一')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '放弃更改', exact: true }).click()
  expect(closed).toBe(true)
  await view.unmount()
})

for (const theme of ['light', 'dark'] as const)
  it(`编辑复用、焦点主要操作、目录失败和保存锁定；${theme} 的画布几何与窄窗`, async () => {
    applyTheme(theme)
    await page.viewport(1000, 800)
    let finish!: (result: { status: 'updated'; project: import('@coko/protocol').Project }) => void
    let completed = false
    const initial = {
      name: 'Example project',
      folders: [
        { path: '/work/app', primary: true },
        { path: '/work/shared', primary: false },
        { path: '/work/docs', primary: false },
      ],
    }
    const view = await render(
      <I18nProvider locale="en">
        <ProjectFormDialog
          mode="edit"
          initial={initial}
          onClose={() => {}}
          pickDirectory={async () => '/missing'}
          checkFolder={async () => {
            throw new ApiError('bad-request', 'Unavailable', 400, { reason: 'unavailable' })
          }}
          onSubmit={() =>
            new Promise((resolve) => {
              finish = resolve
            })
          }
          onComplete={() => {
            completed = true
          }}
        />
      </I18nProvider>,
    )
    const dialog = page.getByRole('dialog', { name: 'Edit project' })
    const node = dialog.element() as HTMLElement
    await expect.poll(() => node.getBoundingClientRect().width).toBe(520)
    const box = node.getBoundingClientRect()
    expect(box.width).toBe(520)
    expect(box.height).toBe(432)
    expect(getComputedStyle(node).borderRadius).toBe('28px')
    await userEvent.hover(page.getByRole('textbox', { name: 'Project name' }))
    await page.screenshot({ element: node, path: `../../../../../../.vitest/cw13-${theme}-multi.png` })
    const row = document.querySelector<HTMLElement>('[data-project-folder="/work/shared"]')!
    const action = row.querySelector<HTMLButtonElement>('[data-make-primary]')!
    action.focus()
    await expect.poll(() => getComputedStyle(action).opacity).toBe('1')
    expect(action.getBoundingClientRect().height).toBe(28)
    expect(getComputedStyle(action).borderRadius).toBe('8px')
    await page.getByRole('button', { name: 'Set as primary' }).first().click()
    await page.getByRole('button', { name: 'Remove shared' }).click()
    expect(document.querySelector('[data-project-folder="/work/docs"]')?.getAttribute('data-primary-folder')).toBe('true')
    await page.getByRole('button', { name: 'Add folder', exact: true }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Cannot access this folder. Check that it exists and you have permission.')
    expect(document.querySelectorAll('[data-project-folder]')).toHaveLength(2)
    await page.viewport(390, 640)
    const narrow = node.getBoundingClientRect()
    expect(narrow.left).toBeGreaterThanOrEqual(16)
    expect(narrow.right).toBeLessThanOrEqual(374)
    expect(node.scrollWidth).toBeLessThanOrEqual(node.clientWidth)
    await expect.element(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible()
    await page.screenshot({ element: node, path: `../../../../../../.vitest/cw13-${theme}-narrow.png` })
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.element(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    await expect.element(page.getByRole('textbox', { name: 'Project name' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog).toBeVisible()
    finish({
      status: 'updated',
      project: { id: 'p', name: initial.name, primaryWorkspaceId: 'w', folders: initial.folders, pinnedAt: null, createdAt: 1, lastUsedAt: 1, sessionCount: 0 },
    })
    await expect.poll(() => completed).toBe(true)
    await view.unmount()
    await page.viewport(1200, 900)
    applyTheme('light')
  })
