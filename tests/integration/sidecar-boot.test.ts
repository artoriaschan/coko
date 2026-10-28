import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES } from '@coko/protocol'
import { client, exchange, request, sidecarDirs, startSidecar } from './sidecar-harness.ts'

describe('Sidecar 启动（ELECTRON_RUN_AS_NODE）', () => {
  it('先发 starting 再发 ready，ready 带端口与 43 字符令牌；交换后 health 可用', async () => {
    const sidecar = await startSidecar({ dirs: await sidecarDirs() })
    expect(sidecar.messages.map((m) => m.type)).toEqual(['starting', 'ready'])
    expect(sidecar.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const cookie = await exchange(sidecar)
    const health = await client(sidecar, cookie).get(API_ROUTES.health)
    expect(health).toMatchObject({ status: 200, body: { status: 'ok' } })
    expect((await request(sidecar.port, 'GET', API_ROUTES.health)).status).toBe(401)
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})

describe('打包产物（--packaged）不读测试钩子', () => {
  it('COKO_SANDBOX_EXEC、COKO_TEST_TOOLS、COKO_FAUX_SCRIPT 被忽略：沙箱用系统 sandbox-exec，不注册测试工具，不启用 faux', async () => {
    const dirs = await sidecarDirs()
    const sidecar = await startSidecar({
      dirs,
      args: ['--data-dir', dirs.dataDir, '--log-dir', dirs.logDir, '--packaged'],
      env: { COKO_SANDBOX_EXEC: '/tmp/coko-fake-sandbox-exec', COKO_TEST_TOOLS: '1', COKO_FAUX_SCRIPT: '/tmp/coko-missing-faux.json' },
    })
    await sidecar.stop()
    const records = (await readFile(join(dirs.logDir, 'sidecar.jsonl'), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { message: string; properties: Record<string, unknown> })
    expect(records.find((r) => r.message === 'test hooks ignored in a packaged build')?.properties.variables).toEqual(
      expect.arrayContaining(['COKO_SANDBOX_EXEC', 'COKO_TEST_TOOLS', 'COKO_FAUX_SCRIPT']),
    )
    const sandbox = records.find((r) => r.message.startsWith('command sandbox'))
    expect(sandbox?.properties.executable).toBe('/usr/bin/sandbox-exec')
    const messages = records.map((r) => r.message)
    expect(messages).not.toContain('test tools enabled')
    expect(messages).not.toContain('faux provider enabled for tests')
  })
})
