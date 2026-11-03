import { expect, it } from 'vitest'
import { allowPermission } from './permissions.ts'

const copy = { mainWebContentsId: 4, webContentsId: 4, permission: 'clipboard-sanitized-write', isMainFrame: true, requestingUrl: 'coko-app://app/' }
it('only the owned Coko main frame may write the clipboard', () => {
  expect(allowPermission(copy)).toBe(true)
  expect(allowPermission({ ...copy, requestingUrl: 'coko-app://app/path?query=1' })).toBe(true)
  expect(allowPermission({ ...copy, webContentsId: 5 })).toBe(false)
  expect(allowPermission({ ...copy, mainWebContentsId: undefined })).toBe(false)
  expect(allowPermission({ ...copy, isMainFrame: false })).toBe(false)
})
it.each(['clipboard-read', 'media', 'notifications', 'geolocation', 'unknown'])('copy does not grant %s', (permission) => {
  expect(allowPermission({ ...copy, permission })).toBe(false)
})
it.each(['https://app/', 'coko-app://other/', 'coko-app://app.example/', 'coko-app://app:90/', 'coko-app://user@app/', 'not a URL'])(
  'copy does not trust %s',
  (requestingUrl) => {
    expect(allowPermission({ ...copy, requestingUrl })).toBe(false)
  },
)
