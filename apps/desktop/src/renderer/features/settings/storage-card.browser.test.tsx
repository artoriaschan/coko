import '../../styles.css'
import { afterEach, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { I18nProvider } from '../../app/i18n.tsx'
import { StorageCard } from './storage-card.tsx'

it('只读显示实际目录，打开对应目录；路径不作为输入项', async () => {
  const paths = { home: '/Users/test/.custom-coko', chatsRoot: '/Users/test/Documents/Coko' }
  const opened: string[] = []
  const screen = await render(
    <I18nProvider locale="zh">
      <StorageCard
        load={async () => paths}
        openDirectory={async (path) => {
          opened.push(path)
          return true
        }}
      />
    </I18nProvider>,
  )
  await expect.element(screen.getByText(paths.home)).toBeVisible()
  await expect.element(screen.getByText(paths.chatsRoot)).toBeVisible()
  expect(screen.container.querySelector('input')).toBeNull()
  await expect.element(screen.getByText(/COKO_HOME/)).toBeVisible()
  await screen.getByRole('button', { name: '打开主数据目录' }).click()
  await screen.getByRole('button', { name: '打开对话与项目目录' }).click()
  expect(opened).toEqual([paths.home, paths.chatsRoot])
})

it('目录不存在或打开失败时显示错误，仍允许重试', async () => {
  let available = false
  const screen = await render(
    <I18nProvider locale="en">
      <StorageCard load={async () => ({ home: '/missing-home', chatsRoot: '/chats' })} openDirectory={async () => available} />
    </I18nProvider>,
  )
  const button = screen.getByRole('button', { name: 'Open application data folder' })
  await button.click()
  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('The folder does not exist or could not be opened. Try again after checking the path. /missing-home')
  available = true
  await button.click()
  await expect.poll(() => screen.container.querySelector('[role="alert"]')).toBeNull()
})

it('读取失败提供重试，恢复后显示路径而不是旧错误', async () => {
  let available = false
  const screen = await render(
    <I18nProvider locale="en">
      <StorageCard
        load={async () => {
          if (!available) throw new Error('network')
          return { home: '/data', chatsRoot: '/chats' }
        }}
      />
    </I18nProvider>,
  )
  await expect.element(screen.getByRole('alert')).toHaveTextContent('Could not load storage locations.')
  available = true
  await screen.getByRole('button', { name: 'Retry' }).click()
  await expect.element(screen.getByText('/data', { exact: true })).toBeVisible()
  expect(screen.container.querySelector('[role="alert"]')).toBeNull()
})

afterEach(async () => {
  document.documentElement.classList.remove('dark')
  await page.viewport(1280, 800)
})

it.each(['zh', 'en'] as const)('%s：窄窗口长路径自然换行，明暗主题和键盘操作可用', async (locale) => {
  await page.viewport(390, 844)
  const paths = { home: '/Users/' + 'long-directory-'.repeat(12) + '/.coko', chatsRoot: '/Documents/Coko' }
  const opened: string[] = []
  const screen = await render(
    <I18nProvider locale={locale}>
      <div className="w-full p-4">
        <StorageCard
          load={async () => paths}
          openDirectory={async (path) => {
            opened.push(path)
            return true
          }}
        />
      </div>
    </I18nProvider>,
  )
  const code = screen.getByText(paths.home).element()
  await expect.element(screen.getByText(paths.home)).toBeVisible()
  expect(code.getBoundingClientRect().height).toBeGreaterThan(20)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
  const card = screen.getByRole('group').element()
  for (const dark of [false, true]) {
    document.documentElement.classList.toggle('dark', dark)
    expect(getComputedStyle(code).color).not.toBe(getComputedStyle(card).backgroundColor)
  }
  const button = screen.getByRole('button', { name: locale === 'zh' ? '打开主数据目录' : 'Open application data folder' })
  ;(button.element() as HTMLElement).focus()
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => opened).toEqual([paths.home])
})
