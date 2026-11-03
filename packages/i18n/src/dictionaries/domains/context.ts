// 上下文用量、File Reference 与压缩（压缩的文案在 context.compaction，不另立领域）。
import { defineDomain } from './define.ts'

export const context = defineDomain(
  {
    ring: {
      label: '上下文已使用 {percent}%',
      unknown: '上下文用量',
    },
    card: {
      title: '上下文用量',
      usage: '{tokens} / {window} · 占比按已用',
      window: '{window} 上下文',
      used: '{percent}% 已用',
      compactAt: '压缩点',
      breakdown: '上下文分类',
      parts: { system: '系统', prompt: '提示词', assistant: '助手', thinking: '思考', tools: '工具' },
      descriptions: {
        system: '系统提示词及其各章节',
        prompt: '用户消息（含图片估算）',
        assistant: '助手正文 + 工具调用名与参数',
        thinking: '助手的思考内容块',
        tools: '工具声明（内置 + MCP）与工具结果',
      },
      loadFailed: '无法读取上下文用量',
    },
    compaction: {
      inProgress: '正在压缩上下文…',
      stop: '停止压缩',
      divider: '已压缩上下文',
      saved: '约节省 {tokens} tokens',
      showSummary: '查看摘要',
      failed: '压缩上下文失败：{message}',
      pausedHint: '自动压缩连续失败，已暂停。可以输入 /compact 手动压缩',
      paused: '自动压缩已暂停',
    },
  },
  {
    ring: {
      label: 'Context {percent}% used',
      unknown: 'Context usage',
    },
    card: {
      title: 'Context usage',
      usage: '{tokens} / {window} · share of used',
      window: '{window} context',
      used: '{percent}% used',
      compactAt: 'Compact at',
      breakdown: 'Context categories',
      parts: { system: 'System', prompt: 'Prompts', assistant: 'Assistant', thinking: 'Thinking', tools: 'Tools' },
      descriptions: {
        system: 'System prompt and all its sections',
        prompt: 'User messages, including image estimates',
        assistant: 'Assistant text, tool names and arguments',
        thinking: 'Assistant thinking blocks',
        tools: 'Tool declarations and tool results',
      },
      loadFailed: 'Could not load context usage',
    },
    compaction: {
      inProgress: 'Compacting context…',
      stop: 'Stop compacting',
      divider: 'Context compacted',
      saved: 'saved about {tokens} tokens',
      showSummary: 'Show summary',
      failed: 'Could not compact the context: {message}',
      pausedHint: 'Auto-compact failed repeatedly and is paused. Type /compact to compact manually',
      paused: 'Auto-compact is paused',
    },
  },
)
