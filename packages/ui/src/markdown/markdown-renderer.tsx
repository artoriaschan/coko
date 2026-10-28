import 'katex/dist/katex.min.css'
import { cjk } from '@streamdown/cjk'
import { createCodePlugin } from '@streamdown/code'
import { math } from '@streamdown/math'
import { createMermaidPlugin } from '@streamdown/mermaid'
import * as React from 'react'
import { Streamdown, type PluginConfig, type StreamdownTranslations } from 'streamdown'
import { cn } from '../lib/utils.ts'

export type MarkdownTranslations = StreamdownTranslations

export interface MarkdownRendererProps {
  children: string
  /** streaming：流式聊天；static：静态文档（关闭流式分块与未闭合语法补全）。 */
  mode: 'streaming' | 'static'
  /** 流式模式下跟随实际生成状态，结束后设为 false。 */
  isAnimating?: boolean
  /** Mermaid 把颜色写进 SVG，需按当前主题选择配色。 */
  colorScheme: 'light' | 'dark'
  /** 已本地化的控件文案（复制、下载、全屏等）。 */
  translations: MarkdownTranslations
  className?: string
}

const code = createCodePlugin({ themes: ['github-light', 'github-dark'] })
const mermaidLight = createMermaidPlugin({ config: { theme: 'default' } })
const mermaidDark = createMermaidPlugin({ config: { theme: 'dark' } })

/** 会话消息与静态文档统一的 Markdown 渲染：code、math、mermaid、cjk 插件，排版由主题样式表的 .coko-markdown 管理。 */
export function MarkdownRenderer({ children, mode, isAnimating = false, colorScheme, translations, className }: MarkdownRendererProps) {
  const plugins = React.useMemo<PluginConfig>(() => ({ code, math, cjk, mermaid: colorScheme === 'dark' ? mermaidDark : mermaidLight }), [colorScheme])
  const streaming = mode === 'streaming'
  return (
    <Streamdown
      className={cn('coko-markdown', className)}
      mode={mode}
      parseIncompleteMarkdown={streaming}
      isAnimating={streaming && isAnimating}
      plugins={plugins}
      translations={translations}
    >
      {children}
    </Streamdown>
  )
}
