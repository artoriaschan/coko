/**
 * Provider 的 API 地址须为 http 或 https URL；模型配置与模型列表共用。agent 不依赖 @coko/protocol，这里与其 isHttpUrl
 * 保持一致（apps/server 的 provider-limits.test.ts 比对两者）。
 */
export function isHttpUrl(text: string): boolean {
  try {
    const { protocol } = new URL(text)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** Catalog identity keeps the URL path; host case and terminal slashes are insignificant. */
export function normalizeModelBaseUrl(text: string): string {
  const url = new URL(text)
  const suffix = url.search + url.hash
  const address = suffix ? url.href.slice(0, -suffix.length) : url.href
  return address.replace(/\/+$/, '') + suffix
}
