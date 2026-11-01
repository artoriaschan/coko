// 秘密不外泄总闸：无界面运行的输出通道（stdout 的三种格式、stderr、<log-dir>/headless.jsonl）与库文件。Credential 只来自
// COKO_CREDENTIAL_<ID>（模型服务替身在错误中回显它），Secret 只来自 COKO_SECRET_<NAME>（secret_probe 注入），另有同形态的宿主环境变量
// （bash env 输出）；faux 的 requestLog 同样扫描。Provider 来自 --provider-config（不含密钥）。
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { customProvider, fauxScript, sidecarDirs, tempDir } from './sidecar-harness.ts'
import { echoingModelServer, leaksIn, marker, readDir } from './secrets-gate-harness.ts'
import { baseArgs, dbRows, lines, runHeadless } from './headless-harness.ts'

describe('秘密不外泄总闸：headless', () => {
  it('stdout（text、json、stream-json）、stderr、日志与库中没有 Credential、Secret 与宿主密钥的明文', { timeout: 180_000 }, async () => {
    const credential = marker('cred')
    const hostSecret = marker('host')
    const toolSecret = marker('tool')
    const root = await realpath(await tempDir())
    const dirs = await sidecarDirs()
    const scratch = await tempDir()
    const baseUrl = await echoingModelServer()
    const configPath = join(scratch, 'providers.json')
    await writeFile(
      configPath,
      JSON.stringify({ providers: [customProvider('gate-provider', baseUrl, ['gate-model'])], defaultModel: 'gate-provider/gate-model' }),
    )
    const env = { COKO_CREDENTIAL_GATE_PROVIDER: credential, MY_SERVICE_API_KEY: hostSecret }
    const outputs: [string, string][] = []
    const record = (label: string, out: { stdout: string; stderr: string }) => outputs.push([`${label} stdout`, out.stdout], [`${label} stderr`, out.stderr])

    // 真实 Provider（替身）：Key 被发出并在错误中回显；三种输出各一次。
    const formats = ['stream-json', 'json', 'text'] as const
    for (const [i, format] of formats.entries()) {
      const args = baseArgs(dirs, '--workspace', root, '--prompt', `hello ${format}`, '--output', format, ...(i === 0 ? ['--provider-config', configPath] : []))
      const out = await runHeadless(dirs, args, env)
      record(format, out)
      expect(out).toMatchObject({ code: 1 })
      // 前置：Key 确实发给了模型服务并被回显（否则"没有明文"不能证明什么）。
      const echoed = format === 'text' ? out.stderr : JSON.stringify(lines(out.stdout).at(-1))
      expect(echoed).toContain('Incorrect API key')
    }

    // faux：bash env（宿主环境剔除）与 secret_probe（Secret 只进其子进程）。
    const requestLog = join(scratch, 'requests.jsonl')
    await writeFile(requestLog, '')
    const script = await fauxScript(scratch, {
      requestLog,
      responses: [
        { content: [{ type: 'toolCall', name: 'bash', id: 'env1', arguments: { command: 'env' } }] },
        { content: [{ type: 'toolCall', name: 'secret_probe', id: 's1', arguments: {} }] },
        { content: 'probed' },
      ],
    })
    const faux = await runHeadless(
      dirs,
      baseArgs(dirs, '--workspace', root, '--prompt', 'dump env', '--output', 'stream-json', '--model', 'faux/faux-1', '--permission-mode', 'full-access'),
      { ...env, COKO_FAUX_SCRIPT: script, COKO_TEST_TOOLS: '1', COKO_SECRET_COKO_TEST_SECRET: toolSecret },
    )
    record('faux', faux)
    expect(faux).toMatchObject({ code: 0 })
    expect(faux.stdout).toContain('PATH=')
    expect(faux.stdout).toContain('sha256')

    // 库中没有 Credential（provider_credentials 为空），Provider 只有连接信息。
    expect(dbRows(dirs, 'SELECT provider_id FROM provider_credentials')).toEqual([])
    expect(dbRows(dirs, 'SELECT id FROM providers')).toEqual([{ id: 'gate-provider' }])
    const files = [...(await readDir(dirs.dataDir)), ...(await readDir(dirs.logDir))]
    expect(files.map((f) => f.name)).toEqual(expect.arrayContaining(['coko.db', 'headless.jsonl']))
    const channels: [string, string | Buffer][] = [
      ...outputs,
      ['faux requestLog', await readFile(requestLog, 'utf8')],
      ...files.map((f): [string, Buffer] => [f.name, f.bytes]),
    ]
    expect(leaksIn(channels, { credential, 'host secret': hostSecret, 'tool secret': toolSecret })).toEqual([])
  })
})
