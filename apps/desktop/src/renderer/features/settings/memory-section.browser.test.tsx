// Memory 分区的搜索框：输入停止 200 ms 后才检索（连续输入只发一次请求，带最后的词），清空时立即恢复列表；有内容时 Escape 只清空、
// 不关闭设置，空框时 Escape 返回应用；检索没有结果时显示"没有匹配的记忆"。分组跟随项目归属（AC-26、AC-27）：项目对话与选了项目的草稿显示
// “用户级”与“项目：<项目名>”两组，项目组的列表、检索与添加针对项目的主要 Workspace；独立对话只有用户级一组；没有会话时沿用提示。
// fetch 在测试中替换（memoryStore 每次请求时取全局 fetch）。
import '../../styles.css'
import type { MemoryEntry, Session } from '@coko/protocol'
import { afterEach, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { memoryStore } from '../../stores/memory-store.ts'
import { createFixtureChat, fixtureSessions } from '../../testing/fixture-chat.ts'
import { settingsRegion } from '../../testing/settings-page.ts'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const memory = (id: string, content: string, workspaceId: string | null = null): MemoryEntry => ({
  id,
  scope: workspaceId === null ? 'user' : 'workspace',
  workspaceId,
  content,
  source: 'user',
  createdAt: 1,
  updatedAt: 1,
})
const all = [memory('a', 'Prefers tabs'), memory('b', 'Uses docker compose')]

afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  memoryStore.setState({ query: '', memories: [], status: 'idle', workspaceId: null })
})

it('搜索框：防抖后检索一次、没有结果的提示、清空恢复列表、Escape 先清空再返回应用', async () => {
  const requests: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      if (input.startsWith('/api/memories')) {
        requests.push(input)
        const query = new URL(input, 'http://x').searchParams.get('query')
        if (query === null) return json(200, { memories: all })
        return json(200, { memories: all.filter((m) => m.content.toLowerCase().includes(query.toLowerCase())) })
      }
      if (input.startsWith('/api/config')) return json(404, { error: { code: 'not-found', message: 'not found' } })
      return json(404, { error: { code: 'not-found', message: 'not found' } })
    }),
  )
  await page.viewport(1280, 800)
  const store = createAppearanceStore({ theme: 'light', locale: 'en' })
  const { chat, settings } = createFixtureChat()
  const settingsPage = createSettingsPageStore()
  const preferences = createPreferences({ appearance: store, settings, onConflict: () => {}, onFailure: () => {} })
  const screen = await render(
    <div style={{ width: '100vw', height: '100vh' }}>
      <App
        store={store}
        connection={createConnectionStore()}
        chat={chat}
        settings={settings}
        preferences={preferences}
        settingsPage={settingsPage}
        pickDirectory={async () => null}
      />
    </div>,
  )
  settingsPage.open('memory')
  const region = settingsRegion()
  const items = () => [...region.element().querySelectorAll('[data-memory-list="user"] [data-memory-id]')].map((el) => el.getAttribute('data-memory-id'))
  await expect.poll(items).toEqual(['a', 'b'])
  const listRequests = requests.length

  const search = region.getByRole('searchbox', { name: 'Search memories' })
  await search.click()
  // 只替换页面的 setTimeout：按键间隔不再受负载影响，防抖只在推进时钟时到期（expect.poll 用 vitest 保存的真实计时器）。
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  await userEvent.keyboard('docker')
  await expect.element(search).toHaveValue('docker')
  vi.advanceTimersByTime(199)
  expect(requests.slice(listRequests)).toEqual([])
  vi.advanceTimersByTime(1)
  vi.useRealTimers()
  await expect.poll(items).toEqual(['b'])
  // 连续输入 6 个字符只发出一次检索，带完整的词。
  expect(requests.slice(listRequests)).toEqual(['/api/memories?query=docker&workspaceId=w-coko'])

  await userEvent.keyboard(' swarm')
  const userEmpty = () => region.element().querySelector('[data-memory-list="user"] [data-memory-empty]')?.textContent
  await expect.poll(userEmpty).toBe('No matching memories')
  expect(requests.at(-1)).toBe('/api/memories?query=docker+swarm&workspaceId=w-coko')

  // 有内容时 Escape 只清空（设置仍打开），列表立即恢复。
  await userEvent.keyboard('{Escape}')
  await expect.element(search).toHaveValue('')
  await expect.poll(items).toEqual(['a', 'b'])
  expect(requests.at(-1)).toBe('/api/memories?workspaceId=w-coko')
  expect(settingsPage.getSnapshot().visible).toBe(true)
  expect(document.activeElement).toBe(search.element())
  // 空框时 Escape 返回应用。
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => settingsPage.getSnapshot().visible).toBe(false)
  await screen.unmount()
})

/** 打开 Memory 分区：项目条目只在请求带上其 Workspace 时返回（与 Sidecar 相同）；记录每个记忆请求（方法、路径与正文）。 */
async function openMemory(
  options: {
    locale?: 'en' | 'zh'
    theme?: 'light' | 'dark'
    sessions?: Session[]
    prepare?: (chat: ReturnType<typeof createFixtureChat>['chat']) => void
  } = {},
) {
  const requests: { method: string; url: string; body?: unknown }[] = []
  const entries = [memory('u', 'Prefers tabs'), memory('c', 'coko uses pnpm', 'w-coko'), memory('p', 'pi uses npm', 'w-pi')]
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      if (!input.startsWith('/api/memories')) return json(404, { error: { code: 'not-found', message: 'not found' } })
      const method = init?.method ?? 'GET'
      requests.push({ method, url: input, ...(init?.body ? { body: JSON.parse(init.body as string) } : {}) })
      if (method === 'POST') return json(201, { ...memory('new', 'x'), ...(JSON.parse(init!.body as string) as object), workspaceId: 'w-coko' })
      const workspaceId = new URL(input, 'http://x').searchParams.get('workspaceId')
      return json(200, { memories: entries.filter((m) => m.workspaceId === null || m.workspaceId === workspaceId) })
    }),
  )
  await page.viewport(1280, 800)
  const appearance = createAppearanceStore({ theme: options.theme ?? 'light', locale: options.locale ?? 'en' })
  const { chat, settings } = createFixtureChat(options.sessions ? { sessions: options.sessions } : {})
  const settingsPage = createSettingsPageStore()
  const preferences = createPreferences({ appearance, settings, onConflict: () => {}, onFailure: () => {} })
  const screen = await render(
    <div style={{ width: '100vw', height: '100vh' }}>
      <App
        store={appearance}
        connection={createConnectionStore()}
        chat={chat}
        settings={settings}
        preferences={preferences}
        settingsPage={settingsPage}
        pickDirectory={async () => null}
      />
    </div>,
  )
  await chat.getState().load()
  options.prepare?.(chat)
  settingsPage.open('memory')
  const region = settingsRegion()
  const group = (scope: string) => region.element().querySelector(`[data-memory-list="${scope}"]`)
  const titles = () => [...region.element().querySelectorAll('[data-memory-list] h3')].map((el) => el.textContent)
  const items = (scope: string) => [...(group(scope)?.querySelectorAll('[data-memory-id]') ?? [])].map((el) => el.getAttribute('data-memory-id'))
  return { requests, region, group, titles, items, screen }
}

it('项目对话：用户级与“项目：<项目名>”两组，项目组的列表、检索与添加针对项目的主要 Workspace', async () => {
  const { requests, region, titles, items, group, screen } = await openMemory()
  await expect.poll(titles).toEqual(['User', 'Project: coko'])
  await expect.poll(() => items('workspace')).toEqual(['c'])
  expect(items('user')).toEqual(['u'])
  expect(requests.at(-1)!.url).toBe('/api/memories?workspaceId=w-coko')

  const project = region.getByRole('textbox', { name: 'Memory content' }).nth(1)
  await project.fill('coko runs vitest')
  await page.elementLocator(group('workspace')!).getByRole('button', { name: 'Add' }).click()
  await expect.poll(() => requests.find((r) => r.method === 'POST')?.body).toEqual({ scope: 'workspace', workspaceId: 'w-coko', content: 'coko runs vitest' })

  // 检索沿用当前范围，结果仍按两组显示。
  await region.getByRole('searchbox', { name: 'Search memories' }).fill('uses')
  await expect.poll(() => requests.at(-1)!.url).toBe('/api/memories?query=uses&workspaceId=w-coko')
  await expect.poll(titles).toEqual(['User', 'Project: coko'])
  await screen.unmount()
})

it('独立对话只有用户级一组，没有项目组与它的添加入口，也没有提示', async () => {
  const standalone: Session = { ...fixtureSessions[0]!, id: 's-solo', workspaceId: 'w-solo', projectId: null, title: 'Solo', updatedAt: 500 }
  const { requests, region, titles, items, screen } = await openMemory({
    sessions: [standalone, ...fixtureSessions],
    prepare: (chat) => chat.getState().openSession('s-solo'),
  })
  await expect.poll(() => items('user')).toEqual(['u'])
  expect(titles()).toEqual(['User'])
  expect(region.getByRole('button', { name: 'Add' }).elements()).toHaveLength(1)
  expect(region.element().textContent).not.toContain('Open a session')
  expect(requests.every((r) => r.url === '/api/memories')).toBe(true)
  await screen.unmount()
})

it('新对话草稿按所选项目显示项目组；没有项目的草稿只有用户级并沿用提示', async () => {
  const draft = await openMemory({ prepare: (chat) => chat.getState().startDraft('w-pi') })
  await expect.poll(draft.titles).toEqual(['User', 'Project: pi'])
  await expect.poll(() => draft.items('workspace')).toEqual(['p'])
  await draft.screen.unmount()

  const blank = await openMemory({ prepare: (chat) => chat.getState().startDraft() })
  await expect.poll(() => blank.items('user')).toEqual(['u'])
  expect(blank.titles()).toEqual(['User'])
  await expect.element(blank.region.getByText('Open a project chat to manage its project memories')).toBeVisible()
  await blank.screen.unmount()
})

/** 经 canvas 把任意 CSS 颜色转为 sRGB，再按 WCAG 公式算相对亮度。 */
function luminance(color: string) {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = [...ctx.getImageData(0, 0, 1, 1).data].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

it.each([
  { locale: 'zh' as const, theme: 'dark' as const, user: '用户级', project: '项目：coko' },
  { locale: 'en' as const, theme: 'light' as const, user: 'User', project: 'Project: coko' },
])('$locale/$theme 分组标题来自字典且可读', async ({ locale, theme, user, project }) => {
  const { group, titles, screen } = await openMemory({ locale, theme })
  await expect.poll(titles).toEqual([user, project])
  const heading = group('workspace')!.querySelector('h3')!
  const background = getComputedStyle(document.body).backgroundColor
  const [a, b] = [luminance(getComputedStyle(heading).color), luminance(background)].sort((x, y) => y - x)
  expect((a! + 0.05) / (b! + 0.05)).toBeGreaterThanOrEqual(4.5)
  await screen.unmount()
})
