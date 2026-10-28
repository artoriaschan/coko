// M1 骨架的静态数据；会话列表与消息流由对话闭环票接入协议后替换。
export interface FixtureSession {
  id: string
  title: string | null
  running?: boolean
}

export interface FixtureWorkspace {
  id: string
  name: string
  sessions: FixtureSession[]
}

export interface FixtureMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
}

export const workspaces: FixtureWorkspace[] = [
  {
    id: 'w-coko',
    name: 'coko',
    sessions: [
      { id: 's-1', title: '设计 token 与三栏骨架', running: true },
      { id: 's-2', title: 'Sidecar startup handshake' },
      { id: 's-3', title: 'SQLite 迁移与租约' },
      { id: 's-4', title: 'ripgrep contract tests' },
      { id: 's-5', title: null },
      { id: 's-6', title: '工具卡 diff 展示' },
      { id: 's-7', title: 'Forge packaging smoke' },
    ],
  },
  {
    id: 'w-pi',
    name: 'pi',
    sessions: [
      { id: 's-8', title: 'Read agent-core event flow' },
      { id: 's-9', title: '对比 coding-agent 截断策略' },
    ],
  },
]

export const messages: FixtureMessage[] = [
  { id: 'm-1', role: 'user', text: '给侧栏加上按工作区分组的会话列表，并说明三栏宽度规则。' },
  {
    id: 'm-2',
    role: 'assistant',
    text: [
      '三栏宽度规则如下：',
      '',
      '| 区域 | 宽度 |',
      '| --- | --- |',
      '| 侧栏 | 264–420px，默认 280px，rail 56px |',
      '| 中栏 | ≥ 400px |',
      '| 右栏 | 45%，≤ 70%，≥ 300px |',
      '',
      '列宽计算：',
      '',
      '```ts',
      'const right = Math.min(frameWidth * 0.7, Math.max(300, frameWidth * 0.45))',
      "const columns = [sidebar, 'minmax(0, 1fr)', right].join(' ') // 中栏在剩余空间中伸缩，窄窗口下由 rail 让出空间",
      '```',
      '',
      '聊天列宽度为 $$\\mathrm{clamp}(680, 0.64w, 920)$$。',
    ].join('\n'),
  },
]
