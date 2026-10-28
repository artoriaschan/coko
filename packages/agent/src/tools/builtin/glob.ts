/**
 * Glob for the find tool: `*` and `?` stay within one path segment, `**` crosses segments,
 * `[...]` / `[!...]` classes and `{a,b}` alternation. Patterns without `/` match the basename;
 * patterns with `/` match the path relative to the search directory.
 */
export function createFindMatcher(pattern: string): (relativePath: string) => boolean {
  const normalized = pattern.replace(/^\.\//, '').replace(/^\//, '')
  const regex = new RegExp(`^${globToRegExpSource(normalized)}$`)
  if (!normalized.includes('/')) {
    return (relativePath) => regex.test(relativePath.slice(relativePath.lastIndexOf('/') + 1))
  }
  return (relativePath) => regex.test(relativePath)
}

function globToRegExpSource(glob: string): string {
  let out = ''
  let inGroup = 0
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i] as string
    if (char === '*') {
      if (glob[i + 1] === '*') {
        const atSegmentStart = i === 0 || glob[i - 1] === '/'
        if (glob[i + 2] === '/' && atSegmentStart) {
          out += '(?:.*/)?'
          i += 2
        } else {
          out += '.*'
          i += 1
        }
      } else {
        out += '[^/]*'
      }
    } else if (char === '?') {
      out += '[^/]'
    } else if (char === '[') {
      const end = glob.indexOf(']', i + 2)
      if (end === -1) {
        out += '\\['
      } else {
        let body = glob.slice(i + 1, end)
        if (body.startsWith('!')) body = `^${body.slice(1)}`
        out += `[${body.replace(/\\/g, '\\\\')}]`
        i = end
      }
    } else if (char === '{') {
      inGroup++
      out += '(?:'
    } else if (char === '}' && inGroup > 0) {
      inGroup--
      out += ')'
    } else if (char === ',' && inGroup > 0) {
      out += '|'
    } else {
      out += char.replace(/[.+^$()|\\\]{}]/g, '\\$&')
    }
  }
  return out
}
