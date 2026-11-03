import { APP_HOST, APP_SCHEME } from './app-protocol.ts'

export interface PermissionRequest {
  mainWebContentsId: number | undefined
  webContentsId: number
  permission: string
  isMainFrame: boolean
  requestingUrl: string
}

/** Permission requests remain denied unless the owned Coko main frame is copying text. */
export function allowPermission(request: PermissionRequest): boolean {
  if (
    request.permission !== 'clipboard-sanitized-write' ||
    !request.isMainFrame ||
    request.mainWebContentsId === undefined ||
    request.webContentsId !== request.mainWebContentsId
  )
    return false
  try {
    const url = new URL(request.requestingUrl)
    return url.protocol === `${APP_SCHEME}:` && url.host === APP_HOST && url.username === '' && url.password === ''
  } catch {
    return false
  }
}
