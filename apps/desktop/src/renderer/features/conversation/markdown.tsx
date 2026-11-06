import { MarkdownRenderer } from '@coko/ui/markdown'
import type { Theme } from '../../app/appearance-store.ts'
import { useI18n } from '../../app/i18n.tsx'

/** 工作台依赖就绪后直接渲染 Markdown，首次正文与流式更新共用同一棵渲染树。 */
export function Markdown({ text, streaming, theme, compact = false }: { text: string; streaming: boolean; theme: Theme; compact?: boolean }) {
  const { dictionary } = useI18n()
  return (
    <MarkdownRenderer
      mode="streaming"
      isAnimating={streaming}
      colorScheme={theme}
      translations={dictionary.markdown}
      tableMaxHeight={0}
      className={compact ? 'conversation-markdown conversation-markdown-compact' : 'conversation-markdown'}
    >
      {text}
    </MarkdownRenderer>
  )
}
