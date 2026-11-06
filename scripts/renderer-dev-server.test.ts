import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { expect, it, onTestFinished } from 'vitest'

const moduleUrl = new URL('../apps/desktop/build/renderer-dev-server.ts', import.meta.url).href

async function start(configFile: string) {
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { createRendererDevServer } from ${JSON.stringify(moduleUrl)};
    const server = await createRendererDevServer(process.argv[1], {});
    console.log('READY ' + server.url);
    process.stdin.once('data', async () => {
      await server.close();
      process.stdin.destroy();
    });
  `,
      configFile,
    ],
    { env: { ...process.env, NODE_ENV: 'development' }, stdio: ['pipe', 'pipe', 'pipe'] },
  )
  const exited = once(child, 'exit')
  const lines = createInterface({ input: child.stdout })
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4096)
  })
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5000)
    try {
      child.stdin.end('close\n')
      const [code, signal] = await exited
      expect({ code, signal, stderr }).toMatchObject({ code: 0, signal: null })
    } finally {
      clearTimeout(timeout)
      lines.close()
    }
  }
  onTestFinished(close)
  const ready = new Promise<string>((resolve) => {
    lines.on('line', (line) => {
      if (line.startsWith('READY ')) resolve(line.slice(6))
    })
  })
  const timeout = setTimeout(() => child.kill('SIGKILL'), 15_000)
  try {
    const url = await Promise.race([
      ready,
      exited.then(() => {
        throw new Error(`Dev server exited before ready: ${stderr}`)
      }),
    ])
    return { url, close }
  } finally {
    clearTimeout(timeout)
  }
}

async function lazyChunk(base: string, root: string) {
  const main = await fetch(`${base}/main.js`)
  expect(main.status).toBe(200)
  const source = await main.text()
  const dep = source.match(/from\s*"([^"]*fixture-dep\.js\?v=[^"]+)"/)?.[1]
  expect({ dep, source }).toMatchObject({ dep: expect.any(String) })
  const dependency = await fetch(new URL(dep!, base))
  expect(dependency.status).toBe(200)
  const code = await dependency.text()
  const lazy = code.match(/import\("([^"()]+\.js(?:\?[^"()]*)?)"\)/)?.[1]
  expect({ lazy, code }).toMatchObject({ lazy: expect.any(String) })
  const url = new URL(lazy!, new URL(dep!, base))
  // A lazy module must remain unfetched until the other process replaces the cache;
  // fetching it now would let Vite keep its transformed code in memory and mask the bug.
  const file = url.pathname.startsWith('/@fs/') ? decodeURIComponent(url.pathname.slice(4)) : join(root, decodeURIComponent(url.pathname))
  return { url, file, body: await readFile(file, 'utf8') }
}

it('keeps loaded lazy dependencies available while another dev process rebuilds its cache and closes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-vite-test-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const dependency = join(root, 'node_modules', 'fixture-dep')
  await mkdir(dependency, { recursive: true })
  await writeFile(join(dependency, 'package.json'), JSON.stringify({ name: 'fixture-dep', version: '1.0.0', type: 'module', main: 'index.js' }))
  await writeFile(join(dependency, 'index.js'), 'export const load = () => import("./body.js")')
  await writeFile(join(dependency, 'body.js'), 'export default __FIXTURE__')
  await writeFile(join(root, 'main.js'), 'import { load } from "fixture-dep"; load()')
  await writeFile(join(root, 'index.html'), '<script type="module" src="/main.js"></script>')
  const configFile = join(root, 'first.config.mjs')
  const otherConfig = join(root, 'second.config.mjs')
  for (const [file, value] of [
    [configFile, 'first'],
    [otherConfig, 'second'],
  ])
    await writeFile(
      file!,
      `export default { root: ${JSON.stringify(root)}, logLevel: 'silent', optimizeDeps: { include: ['fixture-dep'], rolldownOptions: { transform: { define: { __FIXTURE__: ${JSON.stringify(JSON.stringify(value))} } } } } }`,
    )
  const first = await start(configFile)
  const loaded = await lazyChunk(first.url, root)
  expect(loaded.body).toContain('"first"')
  const second = await start(otherConfig)
  const other = await lazyChunk(second.url, root)
  expect(other.body).toContain('"second"')
  const whileRunning = await fetch(loaded.url)
  expect({ status: whileRunning.status, statusText: whileRunning.statusText }).toEqual({ status: 200, statusText: 'OK' })
  expect(await whileRunning.text()).toContain('"first"')
  await second.close()
  await expect(readFile(other.file)).rejects.toThrow(/ENOENT/)
  const afterClose = await fetch(loaded.url)
  expect(afterClose.status).toBe(200)
  expect(await afterClose.text()).toContain('"first"')
  await first.close()
  await expect(readFile(loaded.file)).rejects.toThrow(/ENOENT/)
  // Both HTTP listeners must be gone before the fixture is removed.
  await expect(fetch(first.url)).rejects.toThrow('fetch failed')
  await expect(fetch(second.url)).rejects.toThrow('fetch failed')
}, 45_000)
