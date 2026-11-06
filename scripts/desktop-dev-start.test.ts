import { afterEach, expect, it, vi } from 'vitest'
import type * as Build from '../apps/desktop/build/build.ts'

const build = vi.hoisted(() => ({
  prepareRipgrep: vi.fn<typeof Build.prepareRipgrep>(async () => ''),
  writeSidecarReloadStamp: vi.fn<typeof Build.writeSidecarReloadStamp>(async () => {}),
  watchSidecar: vi.fn<typeof Build.watchSidecar>(),
  watchElectron: vi.fn<typeof Build.watchElectron>(),
  startRendererDevServer: vi.fn<typeof Build.startRendererDevServer>(async () => ({ url: 'http://127.0.0.1:12345', close: async () => {} })),
}))

vi.mock('../apps/desktop/build/build.ts', () => ({
  ...build,
  sidecarReloadFile: '/test/sidecar-build',
  buildElectron: vi.fn<typeof Build.buildElectron>(),
  buildSidecar: vi.fn<typeof Build.buildSidecar>(),
  buildRenderer: vi.fn<typeof Build.buildRenderer>(),
}))

import config from '../apps/desktop/forge.config.ts'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

it('notifies an existing desktop only after initial Sidecar and Electron outputs are ready', async () => {
  vi.stubEnv('COKO_RENDERER_DEV_URL', undefined)
  vi.stubEnv('COKO_SIDECAR_RELOAD_FILE', undefined)
  const sidecar = Promise.withResolvers<void>()
  const electron = Promise.withResolvers<void>()
  build.watchSidecar.mockReturnValue({ ready: sidecar.promise, close: async () => {} })
  build.watchElectron.mockReturnValue({ ready: electron.promise, close: async () => {} })
  const hook = config.hooks?.preStart
  if (typeof hook !== 'function') throw new Error('Expected the Forge preStart hook')
  const starting = hook()
  try {
    await expect.poll(() => build.watchSidecar.mock.calls.length).toBe(1)
    expect(build.writeSidecarReloadStamp).not.toHaveBeenCalled()
    sidecar.resolve()
    await sidecar.promise
    expect(build.writeSidecarReloadStamp).not.toHaveBeenCalled()
    electron.resolve()
    await starting
    expect(build.writeSidecarReloadStamp).toHaveBeenCalledOnce()
    expect(process.env.COKO_SIDECAR_RELOAD_FILE).toBe('/test/sidecar-build')
  } finally {
    sidecar.resolve()
    electron.resolve()
    await starting
  }
})
