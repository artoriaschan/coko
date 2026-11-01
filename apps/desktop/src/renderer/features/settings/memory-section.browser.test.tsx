// Memory 分区的搜索框：输入停止 200 ms 后才检索（连续输入只发一次请求，带最后的词），清空时立即恢复列表；有内容时 Escape 只清空、
// 不关闭设置，空框时 Escape 返回应用；检索没有结果时显示"没有匹配的记忆"。fetch 在测试中替换（memoryStore 每次请求时取全局 fetch）。
import '../../styles.css'
import type { MemoryEntry } from '@coko/protocol'
import { afterEach, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { memoryStore } from '../../stores/memory-store.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'
import { settingsRegion } from '../../testing/settings-page.ts'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const memory = (id: string, content: string): MemoryEntry => ({ id, scope: 'user', workspaceId: null, content, source: 'user', createdAt: 1, updatedAt: 1 })
const all = [memory('a', 'Prefers tabs'), memory('b', 'Uses docker compose')]

afterEach(async () => {
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
  await userEvent.keyboard('docker')
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
