// File Reference 的 token 解析（票 06）：@path 与 @"path with space"，词首触发，结尾标点不算路径，邮箱等不误判。
import { describe, expect, it } from 'vitest'
import { formatFileReferenceToken, parseFileReferences } from './index.ts'

const paths = (text: string) => parseFileReferences(text).map((t) => t.path)

describe('parseFileReferences', () => {
  it.each([
    ['看看 @src/a.ts', ['src/a.ts']],
    ['@README.md 开头', ['README.md']],
    ['两个 @a.ts 和 @b/c.md', ['a.ts', 'b/c.md']],
    ['目录 @src/ 也行', ['src/']],
    ['换行\n@x.ts', ['x.ts']],
    ['@"docs/my notes.md" 有空格', ['docs/my notes.md']],
    ['结尾句号 @src/a.ts.', ['src/a.ts']],
    ['逗号 @a.ts, @b.ts; 还有 @c.ts!', ['a.ts', 'b.ts', 'c.ts']],
    ['中文标点 @a.ts， @b.ts。', ['a.ts', 'b.ts']],
    ['标点之后不是词首 @a.ts，@b.ts', ['a.ts']],
    ['括号里 (@a.ts) 不算词首', []],
    ['问号 @a.ts?', ['a.ts']],
    ['引号路径保留结尾标点 @"a b."', ['a b.']],
  ])('%s', (text, expected) => {
    expect(paths(text)).toEqual(expected)
  })

  it.each([['邮箱 user@example.com 不是引用'], ['没有路径的 @ 单独出现'], ['只有标点 @. 或 @,'], ['空引号 @"" 不算'], ['紧贴文字 看看@src/a.ts']])(
    '%s → 无引用',
    (text) => {
      expect(paths(text)).toEqual([])
    },
  )

  it('给出 token 在原文中的位置（不含被去掉的结尾标点）', () => {
    const text = 'see @src/a.ts, then @"b c.md"'
    const [a, b] = parseFileReferences(text)
    expect(text.slice(a!.start, a!.end)).toBe('@src/a.ts')
    expect(text.slice(b!.start, b!.end)).toBe('@"b c.md"')
    expect(b!.quoted).toBe(true)
  })

  it('formatFileReferenceToken 与解析往返：含空白或会被当作结尾标点的路径加引号', () => {
    for (const path of ['src/a.ts', 'src/', 'docs/my notes.md', 'a b.', 'x.ts,', '笔记，草稿.md']) {
      const token = formatFileReferenceToken(path)
      expect(paths(`看 ${token} 吧`)).toEqual([path])
    }
    expect(formatFileReferenceToken('src/a.ts')).toBe('@src/a.ts')
    expect(formatFileReferenceToken('a b.md')).toBe('@"a b.md"')
  })
})
