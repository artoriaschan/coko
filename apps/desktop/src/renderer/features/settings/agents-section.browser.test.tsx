// 设置 → Agents 分区（ADR 0014）：按来源分组列出内置、用户与项目定义（按当前会话的 Workspace 读取），诊断可展开，注明在文件中编辑；
// 没有会话时只说明位置；读取失败可重试。只读：没有编辑控件。
import '../../styles.css'
import type { AgentDefinitionsResponse } from '@coko/protocol'
import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { ChatStoreProvider } from '../../app/chat.tsx'
import { I18nProvider } from '../../app/i18n.tsx'
import { createAgentsStore } from '../../stores/agents-store.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'
import { AgentsStoreProvider } from '../conversation/agents-button.tsx'
import { AgentsSection } from './agents-section.tsx'

const response: AgentDefinitionsResponse = {
  definitions: [
    { name: 'explore', source: 'builtin', description: 'Investigate code', tools: ['read', 'grep'], permissionMode: 'read-only', maxTurns: 50 },
    { name: 'general', source: 'builtin', description: 'General work', maxTurns: 50 },
    { name: 'reviewer', source: 'user', description: 'Review diffs', model: 'faux/faux-1', maxTurns: 20, path: '/home/me/.coko/agents/reviewer.md' },
    {
      name: 'writer',
      source: 'project',
      description: 'Write docs',
      permissionMode: 'accept-edits',
      maxTurns: 10,
      path: '/Users/me/coko/.coko/agents/writer.md',
    },
  ],
  diagnostics: [{ source: 'agents', code: 'invalid-frontmatter', path: '/Users/me/coko/.coko/agents/broken.md', message: 'name is required' }],
}

async function mount(options: { open?: boolean; fail?: number; locale?: 'zh' | 'en' } = {}) {
  const fixture = createFixtureChat()
  const calls: string[] = []
  let failures = options.fail ?? 0
  const store = createAgentsStore({
    list: async () => [],
    cancel: async () => {},
    answer: async () => {},
    definitions: async (workspaceId) => {
      calls.push(workspaceId)
      if (failures-- > 0) throw new Error('down')
      return response
    },
  })
  await expect.poll(() => fixture.chat.getState().listStatus).toBe('ready')
  if (options.open !== false) fixture.chat.getState().openSession('s-1')
  else fixture.chat.setState({ activeSessionId: null, draftWorkspaceId: null })
  await render(
    <I18nProvider locale={options.locale ?? 'en'}>
      <ChatStoreProvider store={fixture.chat}>
        <AgentsStoreProvider store={store}>
          <div style={{ width: 600 }}>
            <AgentsSection />
          </div>
        </AgentsStoreProvider>
      </ChatStoreProvider>
    </I18nProvider>,
  )
  return { calls }
}

describe('设置 → Agents', () => {
  it('按来源分组列出定义（会话的 Workspace）；诊断折叠、可展开；注明在文件中编辑；没有编辑控件', async () => {
    const h = await mount()
    await expect.poll(() => document.querySelectorAll('[data-agent-definition]').length).toBe(4)
    expect(h.calls).toEqual(['w-coko'])
    const groups = [...document.querySelectorAll('[data-agents-source]')].map((g) => [
      g.getAttribute('data-agents-source'),
      [...g.querySelectorAll('[data-agent-definition]')].map((d) => d.getAttribute('data-agent-definition')),
    ])
    expect(groups).toEqual([
      ['builtin', ['explore', 'general']],
      ['user', ['reviewer']],
      ['project', ['writer']],
    ])
    const explore = document.querySelector('[data-agent-definition="explore"]')!.textContent
    expect(explore).toContain('Tools: read, grep · Permission cap: Read only · Turn limit: 50')
    expect(document.querySelector('[data-agent-definition="general"]')!.textContent).toContain('Tools: all tools of the parent session')
    expect(document.querySelector('[data-agent-definition="writer"]')!.textContent).toContain('/Users/me/coko/.coko/agents/writer.md')
    expect(document.querySelector('[data-slot="agents-edit-hint"]')!.textContent).toBe(
      'Definitions are Markdown files; edit them in the files: user definitions in ~/.coko/agents/*.md, project definitions in .coko/agents/*.md of the session directory',
    )
    const details = document.querySelector('details[data-agents-diagnostics]') as HTMLDetailsElement
    expect(details.open).toBe(false)
    await userEvent.click(page.getByText('Diagnostics (1)'))
    expect(details.open).toBe(true)
    expect(details.querySelector('[data-diagnostic="invalid-frontmatter"]')!.textContent).toContain('broken.md')
    expect(document.querySelector('[data-agents-section] input, [data-agents-section] textarea, [data-agents-section] [contenteditable]')).toBeNull()
  })

  it('没有会话：只说明位置，不读取；读取失败显示重试', async () => {
    const none = await mount({ open: false })
    await expect.element(page.getByText('Open a session to see the project definitions in its directory')).toBeVisible()
    expect(none.calls).toEqual([])
  })

  it('读取失败：重试后显示（中文）', async () => {
    const h = await mount({ fail: 1, locale: 'zh' })
    await expect.element(page.getByText('读取子代理定义失败')).toBeVisible()
    await userEvent.click(page.getByRole('button', { name: '重试' }))
    await expect.poll(() => document.querySelectorAll('[data-agent-definition]').length).toBe(4)
    expect(h.calls).toHaveLength(2)
    expect(document.querySelector('[data-agents-source="builtin"] h3')!.textContent).toBe('内置')
  })
})
