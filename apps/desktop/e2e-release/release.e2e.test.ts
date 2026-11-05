// 发布构建（不带 COKO_TEST_BUILD）的产物 E2E，只在 COKO_RELEASE_E2E=1 时运行（vitest.release.config.ts）。
// 对手用例：发布构建忽略测试钩子。以 COKO_FAUX_SCRIPT、COKO_TEST_CLOCK、COKO_E2E_BACKGROUND、COKO_TEST_UPDATE_FEED_URL 启动打包应用，
// 断言没有可用模型、日志列出被忽略的名字、POST /api/test/clock 404、测试更新源收不到请求（auto update disabled { reason: no-feed }），
// 随包 ripgrep 与 node-pty 被加载；make 的 .zip / .dmg 存在，dmg 只读挂载后有 Coko.app，记录 codesign --verify 的结果后卸载。
// 发布构建忽略后台模式，窗口会出现：以 open -g -n 启动（不激活），经 CDP 连接；进程号从 CDP 的 SystemInfo 读取，只结束这些进程。
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { chromium, type Page } from 'playwright'
import { describe, expect, it, onTestFinished } from 'vitest'
import { processExists, waitFor } from '../e2e/harness.ts'
import { readLogRecords } from '../e2e/logs.ts'
import { RELEASE_OUT_DIR } from './global-setup.ts'

const run = promisify(execFile)
const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
const outRoot = join(desktopRoot, RELEASE_OUT_DIR)
const appBundle = join(outRoot, `Coko-${process.platform}-${process.arch}`, 'Coko.app')
const resources = join(appBundle, 'Contents', 'Resources')

async function filesUnder(dir: string, suffix: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true }).catch(() => [] as string[])
  return entries.filter((entry) => entry.endsWith(suffix)).map((entry) => join(dir, entry))
}

async function childPids(parentPid: number): Promise<{ pid: number; command: string }[]> {
  const { stdout } = await run('ps', ['-A', '-o', 'pid=,ppid=,command='])
  return stdout.split('\n').flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    return m && Number(m[2]) === parentPid ? [{ pid: Number(m[1]), command: m[3]! }] : []
  })
}

/** open -g -n 启动打包应用（环境只经 --env 传入），stderr 写入文件以读取 DevTools 地址；返回窗口与 browser 进程号。 */
async function launchRelease(root: string, env: Record<string, string>): Promise<{ page: Page; pid: number }> {
  const stderrPath = join(root, 'stderr.log')
  const envArgs = Object.entries(env).flatMap(([key, value]) => ['--env', `${key}=${value}`])
  await run('open', ['-g', '-n', '--stderr', stderrPath, ...envArgs, appBundle, '--args', '--remote-debugging-port=0'])
  let endpoint: string | undefined
  await waitFor(
    async () => {
      endpoint = /DevTools listening on (ws:\/\/\S+)/.exec(await readFile(stderrPath, 'utf8').catch(() => ''))?.[1]
      return endpoint !== undefined
    },
    60_000,
    'DevTools endpoint',
  )
  const browser = await chromium.connectOverCDP(endpoint!)
  const cdp = await browser.newBrowserCDPSession()
  const info = (await cdp.send('SystemInfo.getProcessInfo')) as { processInfo: { type: string; id: number }[] }
  const pid = info.processInfo.find((p) => p.type === 'browser')!.id
  const sidecars: number[] = []
  onTestFinished(async () => {
    await browser.close().catch(() => undefined)
    for (const child of await childPids(pid).catch(() => [])) sidecars.push(child.pid)
    if (processExists(pid)) process.kill(pid, 'SIGTERM')
    await waitFor(() => !processExists(pid), 20_000, 'release app exit').catch(() => {
      if (processExists(pid)) process.kill(pid, 'SIGKILL')
    })
    for (const child of sidecars) if (processExists(child)) process.kill(child, 'SIGKILL')
  })
  let page: Page | undefined
  await waitFor(
    () => {
      page = browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((candidate) => candidate.url().startsWith('coko-app://app/'))
      return page !== undefined
    },
    30_000,
    'main window',
  )
  return { page: page!, pid }
}

describe.skipIf(process.platform !== 'darwin')('发布构建产物', { timeout: 240_000 }, () => {
  it('make 产出 .zip 与 .dmg；dmg 只读挂载后有 Coko.app，记录 codesign --verify 的结果后卸载', async () => {
    const zips = await filesUnder(join(outRoot, 'make', 'zip', 'darwin', process.arch), '.zip')
    const dmgs = await filesUnder(join(outRoot, 'make'), '.dmg')
    expect(zips).toHaveLength(1)
    expect(dmgs).toHaveLength(1)
    const mountpoint = await mkdtemp(join(tmpdir(), 'coko-release-dmg-'))
    onTestFinished(() => rm(mountpoint, { recursive: true, force: true }))
    await run('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mountpoint, dmgs[0]!])
    try {
      const mounted = join(mountpoint, 'Coko.app')
      expect(existsSync(mounted)).toBe(true)
      // 签名与公证不在当前范围：只记录 adhoc 签名的校验结果，不断言 Developer ID。
      const verify = await run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', mounted]).then(
        (r) => ({ ok: true, output: r.stderr.trim() }),
        (error: { stderr?: string }) => ({ ok: false, output: String(error.stderr ?? error).trim() }),
      )
      const details = await run('codesign', ['-dv', mounted]).then(
        (r) => r.stderr,
        (error: { stderr?: string }) => String(error.stderr ?? error),
      )
      console.log(
        `[release-e2e] codesign --verify ok=${String(verify.ok)}: ${verify.output}\n${details
          .split('\n')
          .filter((l) => /Signature|TeamIdentifier|flags/.test(l))
          .join('\n')}`,
      )
    } finally {
      await run('hdiutil', ['detach', mountpoint])
    }
  })

  it('对手用例：测试钩子被忽略；没有可用模型；POST /api/test/clock 404；测试更新源收不到请求；随包 ripgrep 与 node-pty', async () => {
    const root = await mkdtemp(join(tmpdir(), 'coko-release-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const feedRequests: string[] = []
    const feed = createServer((req, res) => {
      feedRequests.push(req.url ?? '')
      res.writeHead(204).end()
    })
    await new Promise<void>((resolve) => feed.listen(0, '127.0.0.1', resolve))
    onTestFinished(() => new Promise<void>((resolve) => feed.close(() => resolve())))
    const script = join(root, 'faux.json')
    await writeFile(script, JSON.stringify({ responses: [{ content: 'faux must not answer in a release build' }] }))
    const userData = join(root, 'user-data')
    const hooks = {
      COKO_FAUX_SCRIPT: script,
      COKO_TEST_CLOCK: '1',
      COKO_E2E_BACKGROUND: '1',
      COKO_TEST_UPDATE_FEED_URL: `http://127.0.0.1:${(feed.address() as AddressInfo).port}/feed`,
    }
    const { page, pid } = await launchRelease(root, { COKO_USER_DATA_DIR: userData, COKO_HOME: join(root, 'coko-home'), ...hooks })
    await waitFor(async () => (await page.locator('[role="status"]').getAttribute('data-connection')) === 'connected', 60_000, 'sidecar connected')

    // 随包 Sidecar 由应用以 ELECTRON_RUN_AS_NODE 启动（参数带 --packaged 与随包 ripgrep）。
    const sidecar = (await childPids(pid)).find((p) => p.command.includes(join(resources, 'sidecar', 'index.mjs')))
    expect(sidecar?.command).toContain('--packaged')
    expect(sidecar?.command).toContain(`--ripgrep ${join(resources, 'ripgrep', 'rg')}`)

    // 测试时钟没有挂载；faux provider 没有注册：没有 Provider，设置 → 模型显示需要添加 Provider。
    const status = await page.evaluate(
      async () => (await fetch('/api/test/clock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"advanceMs":1}' })).status,
    )
    expect(status).toBe(404)
    const providers = await page.evaluate(async () => ((await (await fetch('/api/providers')).json()) as { providers: unknown[] }).providers)
    expect(providers).toEqual([])
    await page.getByRole('button', { name: /^(Settings|设置)$/ }).click()
    await page.locator('[data-settings-page] nav [data-section="models"]').click()
    await expect
      .poll(() => page.locator('[data-settings-page]').textContent(), { timeout: 15_000 })
      .toMatch(/No providers yet\. Add one to start a conversation\.|还没有/)
    // 关于页（接收侧）：更新 disabled，原因是没有更新源。
    await page.locator('[data-settings-page] nav [data-section="about"]').click()
    await expect.poll(() => page.locator('[data-settings-page] [data-update-state]').getAttribute('data-update-state')).toBe('disabled')
    await expect
      .poll(() => page.locator('[data-settings-page] [data-update-detail]').textContent())
      .toMatch(/^(This build has no update source|此版本没有配置更新源)$/)
    await expect.poll(() => page.locator('[data-settings-page] [data-action="check-updates"]').isDisabled()).toBe(true)

    // 正常退出以刷新日志（SIGTERM → before-quit → 关闭 Sidecar）。
    process.kill(pid, 'SIGTERM')
    await waitFor(() => !processExists(pid), 30_000, 'release app exit')
    if (sidecar) await waitFor(() => !processExists(sidecar.pid), 10_000, 'sidecar exit')
    expect(feedRequests).toEqual([])

    const desktop = await readLogRecords(join(root, 'coko-home', 'data', 'logs', 'desktop.jsonl'))
    const sidecarLog = await readLogRecords(join(root, 'coko-home', 'data', 'logs', 'sidecar.jsonl'))
    expect(desktop.find((r) => r.message === 'app starting')?.properties).toMatchObject({ packaged: true, testBuild: false, background: false })
    expect(desktop.find((r) => r.message === 'test hooks ignored in a packaged build')?.properties.variables).toEqual(
      expect.arrayContaining(Object.keys(hooks)),
    )
    expect(desktop.find((r) => r.message === 'auto update disabled')?.properties).toMatchObject({ reason: 'no-feed' })
    expect(desktop.map((r) => r.message)).not.toContain('auto update enabled')
    expect(sidecarLog.find((r) => r.message === 'pty backend selected')?.properties).toMatchObject({
      backend: 'node-pty',
      path: join(resources, 'sidecar', 'node_modules', 'node-pty', 'package.json'),
    })
    expect(sidecarLog.find((r) => r.message === 'grep implementation selected')?.properties).toMatchObject({
      implementation: 'ripgrep',
      path: join(resources, 'ripgrep', 'rg'),
    })
    expect(sidecarLog.map((r) => r.message)).not.toContain('faux provider enabled for tests')
    // 值不进日志：只有名字。
    for (const text of [JSON.stringify(desktop), JSON.stringify(sidecarLog)]) expect(text).not.toContain(script)
  })
})
