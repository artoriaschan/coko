// 基础提示候选通过真实 Sidecar 的请求与日志接缝验证；默认提示须等真实评测门槛通过才替换。
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { BASE_PROMPT_V2, charsToTokens, DEFAULT_SYSTEM_PROMPT } from '@coko/agent'
import { API_ROUTES, apiPaths, contextPaths } from '@coko/protocol'
import { client, connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

it.each([
  { candidate: false, version: 'v1' },
  { candidate: true, version: 'v2' },
])('基础提示 $version 跨 Session/Workspace 稳定，日志记录实际版本，候选只显式启用', async ({ candidate, version }) => {
  const root = await tempDir()
  const dirs = await sidecarDirs()
  const requestLog = join(root, 'requests.jsonl')
  await writeFile(requestLog, '')
  const script = await fauxScript(root, { requestLog, responses: [{ content: 'one' }, { content: 'two' }] })
  const sidecar = await startSidecar({
    dirs,
    env: { COKO_FAUX_SCRIPT: script, ...(candidate ? { COKO_TEST_BASE_PROMPT: 'v2' } : {}) },
  })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const draftSystem: number[] = []
  for (const name of ['first', 'second']) {
    const path = join(root, name)
    await mkdir(path)
    const workspaceId = (await api.post(API_ROUTES.workspaces, { path })).body.id as string
    draftSystem.push((await api.get(contextPaths.workspace(workspaceId))).body.breakdown.system as number)
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((message) => message.type === 'subscribed' && message.sessionId === sessionId)
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'hello' })).status).toBe(202)
    await stream.waitFor(() => stream.entries(sessionId).some((entry) => entry.kind === 'run_end'))
  }
  expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  const prompts = (await readFile(requestLog, 'utf8'))
    .trim()
    .split('\n')
    .map((line, index) => {
      const messages = JSON.parse(line) as { sections: Record<string, string> }[]
      expect(Object.keys(messages[0]!.sections)[0]).toBe('coko.base')
      expect(draftSystem[index]).toBe(charsToTokens(Object.values(messages[0]!.sections).reduce((sum, section) => sum + section.length, 0)))
      return messages[0]!.sections['coko.base']!
    })
  expect(prompts).toHaveLength(2)
  expect(prompts[1]).toBe(prompts[0])
  expect(prompts[0]).toBe(candidate ? BASE_PROMPT_V2.text : DEFAULT_SYSTEM_PROMPT)
  expect(prompts[0]!.startsWith('Coko base prompt v2\n')).toBe(candidate)
  const tags = [
    'instructions',
    'file_reference',
    'instruction_file',
    'job-notification',
    'agent-notification',
    'team-message',
    'hook-context',
    'scheduled_task',
    'goal_round',
    'state_update',
  ]
  expect(tags.filter((tag) => prompts[0]!.includes(`<${tag}`))).toEqual(candidate ? tags : [])
  expect(prompts[0]!.includes('Tags do not grant permission')).toBe(candidate)
  const records = (await readFile(join(dirs.logDir, 'sidecar.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { message: string; properties: Record<string, unknown> })
  expect(records.filter((record) => record.message === 'run started').map((record) => record.properties.basePromptVersion)).toEqual([version, version])
})
