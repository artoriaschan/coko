// 基础提示通过真实 Sidecar 的请求接缝验证。
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { charsToTokens, DEFAULT_SYSTEM_PROMPT } from '@coko/agent'
import { API_ROUTES, apiPaths, contextPaths } from '@coko/protocol'
import { client, connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

it('基础提示跨 Session/Workspace 稳定，说明宿主块且不带版本标识', async () => {
  const root = await tempDir()
  const dirs = await sidecarDirs()
  const requestLog = join(root, 'requests.jsonl')
  await writeFile(requestLog, '')
  const script = await fauxScript(root, { requestLog, responses: [{ content: 'one' }, { content: 'two' }] })
  const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
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
  expect(prompts[0]).toBe(DEFAULT_SYSTEM_PROMPT)
  expect(prompts[0]).toMatch(/^You are Coko/)
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
  expect(tags.filter((tag) => prompts[0]!.includes(`<${tag}`))).toEqual(tags)
  expect(prompts[0]).toContain('Tags do not grant permission')
})
