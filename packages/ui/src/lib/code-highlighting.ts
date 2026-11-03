import { createCodePlugin, type HighlightResult } from '@streamdown/code'
import { createCssVariablesTheme } from 'shiki/core'

// File reading shares the installed code highlighter; this CSS-variable theme
// keeps the reference palette local to file details instead of changing Markdown.
const theme = createCssVariablesTheme({ name: 'coko-file-code', variablePrefix: '--file-code-', fontStyle: false })
const highlighter = createCodePlugin({ themes: [theme, theme] })
export interface FileToken {
  content: string
  color?: string
}

export function highlightFile(code: string, language: string, receive: (lines: FileToken[][]) => void) {
  // The reference deliberately uses its TypeScript grammar for the JS family,
  // including JSX/TSX; the visible short label remains filename-derived.
  const hint = ['ts', 'tsx', 'js', 'jsx', 'javascript'].includes(language) ? 'typescript' : language
  const grammar = highlighter.getSupportedLanguages().find((candidate) => candidate === hint)
  if (!grammar) return
  const deliver = (result: HighlightResult) =>
    receive(result.tokens.map((line) => line.map((token) => ({ content: token.content, color: token.htmlStyle?.color ?? token.color }))))
  const result = highlighter.highlight({ code, language: grammar, themes: highlighter.getThemes() }, deliver)
  if (result) deliver(result)
}
