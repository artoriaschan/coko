import * as React from 'react'
import type { Theme } from '../../app/appearance-store.ts'
import { useI18n } from '../../app/i18n.tsx'

// Streamdown 及其 Shiki / Mermaid / KaTeX 插件体积大，按需加载，不进入 renderer 主 chunk。
const LazyMarkdownRenderer = React.lazy(() => import('@coko/ui/markdown').then((module) => ({ default: module.MarkdownRenderer })))

/** 助手消息正文：加载渲染器期间以纯文本占位，流式状态跟随实际生成。 */
export function Markdown({ text, streaming, theme }: { text: string; streaming: boolean; theme: Theme }) {
  const { dictionary } = useI18n()
  return (
    <React.Suspense fallback={<p className="text-ui-body-lg whitespace-pre-wrap">{text}</p>}>
      <LazyMarkdownRenderer mode="streaming" isAnimating={streaming} colorScheme={theme} translations={dictionary.markdown}>
        {text}
      </LazyMarkdownRenderer>
    </React.Suspense>
  )
}
