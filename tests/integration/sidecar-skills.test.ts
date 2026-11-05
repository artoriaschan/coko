// Skills：真实 Sidecar（faux 模型），夹具 tests/fixtures/skills 复制到临时 Workspace、临时 COKO_HOME 与其同级的 .agents。
// 断言 faux requestLog 中实际发给模型的 <available_skills> 与工具、提交的条目（approval_request、command、toolResult）与 GET /api/skills。
import { cp, mkdir, readFile, realpath, symlink, utimes, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DATE_TEST_BLOCK as dateBlock, DATE_TEST_ENV } from './date-state-fixture.ts'
import { API_ROUTES, apiPaths, commandPaths, configPaths, permissionPaths, skillPaths, type SessionEntryRecord } from '@coko/protocol'
import { client, connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir, waitApproval, type Stream } from './sidecar-harness.ts'

const fixtures = fileURLToPath(new URL('../fixtures/skills/', import.meta.url))

type LoggedMessage = {
  role: string
  content: unknown
  sections?: Record<string, string | null>
  toolsAdded?: { name: string }[]
  toolsRemoved?: { name: string }[]
}
type Api = ReturnType<typeof client>

const toolCall = (id: string, name: string, args: Record<string, unknown>) => ({ type: 'toolCall', name, id, arguments: args })

/** responses 可依赖临时目录（Skill 文件的绝对路径）。 */
async function boot(responses: unknown[] | ((paths: { cokoHome: string; workspaceDir: string }) => unknown[])) {
  const root = await realpath(await tempDir())
  const workspaceDir = join(root, 'workspace')
  await cp(join(fixtures, 'workspace'), workspaceDir, { recursive: true })
  const dirs = await sidecarDirs()
  await cp(join(fixtures, 'coko-home'), dirs.cokoHome, { recursive: true })
  // 用户级 .agents/skills 是 COKO_HOME 的同级目录（测试不读真实家目录）。
  const agentsHome = join(dirname(dirs.cokoHome), '.agents')
  await cp(join(fixtures, 'agents-home'), agentsHome, { recursive: true })
  const requestLog = join(root, 'requests.jsonl')
  await writeFile(requestLog, '')
  const script = await fauxScript(root, {
    responses: typeof responses === 'function' ? responses({ cokoHome: dirs.cokoHome, workspaceDir }) : responses,
    requestLog,
  })
  const sidecar = await startSidecar({ dirs, env: { ...DATE_TEST_ENV, COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspace = (await api.post(API_ROUTES.workspaces, { path: workspaceDir })).body as { id: string; path: string }
  const newSession = async (mode?: string) => {
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.id })).body.id as string
    if (mode) {
      const changed = await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode })
      if (changed.status !== 200) throw new Error(`permission mode not set: ${changed.status}`)
    }
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
    return sessionId
  }
  const requests = async () =>
    (await readFile(requestLog, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LoggedMessage[])
  return { sidecar, api, stream, workspace, workspaceDir, dirs, agentsHome, newSession, requests }
}

const runEnds = (stream: Stream, sessionId: string) => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length
async function send(api: Api, stream: Stream, sessionId: string, text: string, during?: () => Promise<void>) {
  const before = runEnds(stream, sessionId)
  expect((await api.post(apiPaths.sessionMessages(sessionId), { text })).status).toBe(202)
  if (during) await during()
  await stream.waitFor(() => runEnds(stream, sessionId) > before)
}

/** 依次重放请求中的系统消息：当前的 sections 与模型可调用的工具名。 */
function replay(messages: LoggedMessage[]) {
  const sections: Record<string, string> = {}
  const tools = new Set<string>()
  for (const m of messages) {
    if (m.role !== 'system') continue
    for (const [name, text] of Object.entries(m.sections ?? {})) {
      if (text === null) delete sections[name]
      else sections[name] = text
    }
    for (const t of m.toolsAdded ?? []) tools.add(t.name)
    for (const t of m.toolsRemoved ?? []) tools.delete(t.name)
  }
  return { sections, tools }
}

const toolResults = (stream: Stream, sessionId: string) =>
  stream
    .entries(sessionId)
    .filter((e) => e.kind === 'message' && (e.payload as { role: string }).role === 'toolResult')
    .map((e) => e.payload as { toolCallId: string; toolName: string; isError: boolean; details?: unknown; content: { text?: string }[] })
const approvals = (stream: Stream, sessionId: string) => stream.entries(sessionId).filter((e) => e.kind === 'approval_request')
const kindOf = (e: SessionEntryRecord) => (e.kind === 'message' ? (e.payload as { role: string }).role : e.kind)
const textOf = (content: unknown) =>
  typeof content === 'string' ? content : (content as { type: string; text?: string }[]).map((b) => (b.type === 'text' ? (b.text ?? '') : '')).join('')
const userTexts = (entries: SessionEntryRecord[]) => entries.filter((e) => kindOf(e) === 'user').map((e) => textOf((e.payload as { content: unknown }).content))

describe('Skill 调用', () => {
  it(
    '<available_skills> 列出可由模型调用的 Skill；skill 工具在各模式下都不审批；读 Skill 目录内的文件不审批，bash 运行其脚本仍审批（allowed-tools: Bash(*) 不放行）',
    { timeout: 120_000 },
    async () => {
      const modes = ['read-only', 'default', 'accept-edits', 'full-access']
      const { api, stream, newSession, requests, dirs, workspaceDir, agentsHome, sidecar } = await boot(({ cokoHome, workspaceDir }) => [
        ...modes.flatMap((_, i) => [{ content: [toolCall(`s${i}`, 'skill', { name: 'notes', args: 'weekly sync' })] }, { content: 'loaded' }]),
        { content: [toolCall('r1', 'read', { path: join(cokoHome, 'skills/notes/reference.md') })] },
        { content: [toolCall('b1', 'bash', { command: `sh ${join(cokoHome, 'skills/notes/scripts/archive.sh')}` })] },
        { content: [toolCall('b2', 'bash', { command: `sh ${join(workspaceDir, '.coko/skills/pdf/scripts/extract.sh')}` })] },
      ])
      const notesDir = join(dirs.cokoHome, 'skills/notes')
      for (const mode of modes) {
        const sessionId = await newSession(mode)
        await send(api, stream, sessionId, `take notes (${mode})`)
        expect(approvals(stream, sessionId)).toEqual([])
        const [result] = toolResults(stream, sessionId)
        expect(result).toMatchObject({ toolName: 'skill', isError: false })
        const text = result!.content[0]!.text!
        expect(text.startsWith(`<skill name="notes" location="${notesDir}/SKILL.md">\nBase directory for this skill: ${notesDir}\n`)).toBe(true)
        expect(text).toContain('NOTES-SKILL-BODY')
        expect(text).not.toContain('description:')
        expect(text).toContain('<skill_files>\nreference.md\nscripts/archive.sh\n</skill_files>')
        expect(text.endsWith('ARGUMENTS: weekly sync')).toBe(true)
        expect(result!.details).toEqual({
          name: 'notes',
          path: `${notesDir}/SKILL.md`,
          baseDir: notesDir,
          files: ['reference.md', 'scripts/archive.sh'],
          filesTruncated: false,
        })
      }

      // 发给模型的索引：项目 > 用户 > 用户 .agents；disable-model-invocation 的 deploy、不合规的与被遮蔽的不列。
      const first = replay((await requests())[0]!)
      expect(first.tools.has('skill')).toBe(true)
      const index = first.sections.skills!
      expect(index.startsWith('<available_skills>\n')).toBe(true)
      expect([...index.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1])).toEqual(['pdf', 'notes', 'lint'])
      expect(index).toContain(`<location>${join(workspaceDir, '.coko/skills/pdf/SKILL.md')}</location>`)
      expect(index).toContain(`<location>${join(agentsHome, 'skills/lint/SKILL.md')}</location>`)
      for (const absent of ['deploy', 'right-name', 'User-level pdf']) expect(index).not.toContain(absent)
      // 指令之后、Memory 之前（Memory 为空时不注入）。
      expect(Object.keys(first.sections)).toEqual(['coko.base', 'environment', 'skills'])

      // default：读 Skill 目录（Workspace 之外）内的参考文件不审批；bash 运行其脚本审批（拒绝后 Run 结束），项目 Skill 的 Bash(*) 也不放行。
      const sessionId = await newSession()
      await send(api, stream, sessionId, 'use the notes template', async () => {
        const archive = await waitApproval(stream, sessionId, 1)
        expect(archive).toMatchObject({ toolCallId: 'b1', toolName: 'bash', kind: 'tool' })
        expect((await api.post(apiPaths.sessionApproval(sessionId, archive.requestId), { decision: 'deny' })).status).toBe(204)
      })
      await send(api, stream, sessionId, 'extract the pdf', async () => {
        const extract = await waitApproval(stream, sessionId, 2)
        expect(extract).toMatchObject({ toolCallId: 'b2', toolName: 'bash', kind: 'tool' })
        expect((await api.post(apiPaths.sessionApproval(sessionId, extract.requestId), { decision: 'deny' })).status).toBe(204)
      })
      expect(approvals(stream, sessionId).map((e) => (e.payload as { toolCallId: string }).toolCallId)).toEqual(['b1', 'b2'])
      const results = toolResults(stream, sessionId)
      expect(results.map((r) => [r.toolCallId, r.isError])).toEqual([
        ['r1', false],
        ['b1', true],
        ['b2', true],
      ])
      expect(results[0]!.content[0]!.text).toContain('NOTES-REFERENCE')
      expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
    },
  )

  it('Skill(name) 的 deny 规则拒绝调用（项目设置与 Workspace 规则）；其余 Skill 照常', { timeout: 60_000 }, async () => {
    const { api, stream, newSession, workspace, workspaceDir } = await boot([
      { content: [toolCall('s1', 'skill', { name: 'notes' })] },
      { content: 'denied' },
      { content: [toolCall('s2', 'skill', { name: 'pdf' })] },
      { content: 'denied' },
      { content: [toolCall('s3', 'skill', { name: 'lint' })] },
      { content: 'ok' },
    ])
    await writeFile(join(workspaceDir, '.coko/settings.json'), JSON.stringify({ permissions: { deny: ['Skill(notes)'] } }))
    const saved = await api.put(permissionPaths.permissions, {
      target: 'workspace',
      workspaceId: workspace.id,
      rules: [{ behavior: 'deny', tool: 'skill', content: 'pdf' }],
      expectedRevision: 0,
    })
    expect(saved.status).toBe(200)
    // 规则工具名归一为 Skill（skill 工具按 Run 贡献，不在宿主的基础工具中）。
    expect(saved.body.workspace.rules).toEqual([{ behavior: 'deny', tool: 'Skill', content: 'pdf' }])
    const sessionId = await newSession('full-access')
    await send(api, stream, sessionId, 'notes')
    await send(api, stream, sessionId, 'pdf')
    await send(api, stream, sessionId, 'lint')
    expect(approvals(stream, sessionId)).toEqual([])
    const results = toolResults(stream, sessionId)
    expect(results.map((r) => [r.toolCallId, r.isError])).toEqual([
      ['s1', true],
      ['s2', true],
      ['s3', false],
    ])
    expect(results[0]!.content[0]!.text).toMatch(/Skill\(notes\)/)
    expect(results[2]!.content[0]!.text).toContain('LINT-SKILL-BODY')
  })

  it('/pdf 参数 → command { source: skill } 与 <skill …> 展开；disable-model-invocation 的 /deploy 可显式调用', { timeout: 60_000 }, async () => {
    const { api, stream, newSession, requests, workspaceDir } = await boot([{ content: 'a' }, { content: 'b' }])
    const sessionId = await newSession()
    await send(api, stream, sessionId, '/pdf report.pdf')
    await send(api, stream, sessionId, '/deploy staging')
    const entries = stream.entries(sessionId)
    expect(entries.map(kindOf)).toEqual([
      'permission_mode',
      'run_start',
      'state_update',
      'command',
      'user',
      'model_request',
      'assistant',
      'run_end',
      'run_start',
      'command',
      'user',
      'model_request',
      'assistant',
      'run_end',
    ])
    expect(entries[2]!.payload).toEqual({ name: 'date', value: { date: '2026-11-05', weekday: 'Thursday' } })
    expect(entries.filter((e) => e.kind === 'command').map((e) => e.payload)).toEqual([
      { name: 'pdf', args: 'report.pdf', source: 'skill' },
      { name: 'deploy', args: 'staging', source: 'skill' },
    ])
    const pdfDir = join(workspaceDir, '.coko/skills/pdf')
    const [pdf, deploy] = userTexts(entries)
    expect(pdf!.startsWith(`${dateBlock}<skill name="pdf" location="${pdfDir}/SKILL.md">\nBase directory for this skill: ${pdfDir}\n`)).toBe(true)
    expect(pdf).toContain('PDF-SKILL-BODY')
    expect(pdf).toContain('<skill_files>\nscripts/extract.sh\n</skill_files>')
    expect(pdf!.endsWith('</skill>\n\nreport.pdf')).toBe(true)
    expect(deploy).toContain('DEPLOY-SKILL-BODY')
    expect(deploy!.endsWith('</skill>\n\nstaging')).toBe(true)
    const sent = (await requests())
      .at(-1)!
      .filter((m) => m.role === 'user')
      .map((m) => textOf(m.content))
    expect(sent).toEqual([pdf, deploy])
    expect(sent.some((text) => text!.startsWith('/'))).toBe(false)
  })

  it('skills.disabled（全局与项目追加）的 Skill 既不进索引也不能调用；skills.enabled=false 时不注入、不注册工具', { timeout: 90_000 }, async () => {
    const { api, stream, newSession, requests, workspace, workspaceDir } = await boot([
      { content: [toolCall('s1', 'skill', { name: 'notes' })] },
      { content: 'x' },
      { content: [toolCall('s2', 'skill', { name: 'lint' })] },
      { content: 'y' },
      { content: 'z' },
      { content: 'w' },
    ])
    expect((await api.put(configPaths.config, { values: { skills: { disabled: ['notes'] } }, expectedRevision: 0 })).status).toBe(200)
    await writeFile(join(workspaceDir, '.coko/settings.json'), JSON.stringify({ skills: { disabled: ['lint'] } }))
    const sessionId = await newSession('full-access')
    await send(api, stream, sessionId, 'notes please')
    await send(api, stream, sessionId, 'lint please')
    await send(api, stream, sessionId, '/notes now')
    const index = replay((await requests())[0]!).sections.skills!
    expect([...index.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1])).toEqual(['pdf'])
    const results = toolResults(stream, sessionId)
    expect(results.map((r) => [r.toolCallId, r.isError])).toEqual([
      ['s1', true],
      ['s2', true],
    ])
    expect(results[0]!.content[0]!.text).toMatch(/Unknown skill "notes"/)
    // 停用的 Skill 的 /notes 原样作为普通消息，没有 command 条目。
    expect(stream.entries(sessionId).filter((e) => e.kind === 'command')).toEqual([])
    expect(userTexts(stream.entries(sessionId)).at(-1)).toBe('/notes now')
    const listed = (await api.get(`${skillPaths.skills}?workspaceId=${workspace.id}`)).body as { skills: { name: string; enabled: boolean }[] }
    expect(listed.skills.map((s) => [s.name, s.enabled])).toEqual([
      ['deploy', true],
      ['pdf', true],
      ['notes', false],
      ['lint', false],
    ])

    expect((await api.put(configPaths.config, { values: { skills: { enabled: false, disabled: ['notes'] } }, expectedRevision: 1 })).status).toBe(200)
    await send(api, stream, sessionId, 'anything')
    const off = replay((await requests()).at(-1)!)
    expect(off.sections).not.toHaveProperty('skills')
    expect(off.tools.has('skill')).toBe(false)
    expect((await api.get(`${skillPaths.skills}?workspaceId=${workspace.id}`)).body.skills.every((s: { enabled: boolean }) => !s.enabled)).toBe(true)
  })
})

describe('项目 Skill 的边界（ADR 0008）', () => {
  it('<Workspace>/.coko/skills/x 指向 Workspace 之外时不加载、不成为读取根：读取外部文件仍审批，GET /api/skills 给出诊断', { timeout: 60_000 }, async () => {
    const outside = await tempDir('coko-outside-skill-')
    await mkdir(join(outside, 'escape'), { recursive: true })
    await writeFile(join(outside, 'escape/SKILL.md'), '---\nname: escape\ndescription: Outside skill\n---\nOUTSIDE-SKILL-BODY\n')
    await writeFile(join(outside, 'escape/private.txt'), 'OUTSIDE-PRIVATE')
    const { api, stream, newSession, workspace, workspaceDir, requests } = await boot([
      { content: [toolCall('r1', 'read', { path: join(outside, 'escape/private.txt') })] },
      { content: 'done' },
    ])
    await symlink(join(outside, 'escape'), join(workspaceDir, '.coko/skills/escape'))
    const listed = (await api.get(`${skillPaths.skills}?workspaceId=${workspace.id}`)).body as {
      skills: { name: string }[]
      diagnostics: { code: string; path?: string }[]
    }
    expect(listed.skills.map((s) => s.name)).not.toContain('escape')
    expect(listed.diagnostics).toContainEqual(
      expect.objectContaining({ source: 'skills', code: 'skill-outside-workspace', path: join(workspaceDir, '.coko/skills/escape/SKILL.md') }),
    )
    const sessionId = await newSession()
    await send(api, stream, sessionId, 'read the outside file', async () => {
      const request = await waitApproval(stream, sessionId, 1)
      expect(request).toMatchObject({ toolCallId: 'r1', toolName: 'read', kind: 'tool' })
      expect((await api.post(apiPaths.sessionApproval(sessionId, request.requestId), { decision: 'deny' })).status).toBe(204)
    })
    expect(replay((await requests())[0]!).sections.skills).not.toContain('escape')
    expect(JSON.stringify(stream.entries(sessionId))).not.toContain('OUTSIDE-PRIVATE')
  })
})

describe('GET /api/skills', () => {
  it(
    '列出 Skill（来源、路径、启停、声明的工具）与诊断（name 与目录名不同、被遮蔽）；命令目录登记 Skill 来源；缺参数 400、不存在 404',
    { timeout: 60_000 },
    async () => {
      const { api, workspace, workspaceDir, dirs, agentsHome } = await boot([])
      const res = await api.get(`${skillPaths.skills}?workspaceId=${workspace.id}`)
      expect(res.status).toBe(200)
      expect(res.body.skills).toEqual([
        {
          name: 'deploy',
          description: 'Deploy the project to an environment.',
          path: join(workspaceDir, '.coko/skills/deploy/SKILL.md'),
          scope: 'project',
          enabled: true,
          allowedTools: [],
          disableModelInvocation: true,
        },
        {
          name: 'pdf',
          description: 'Extract text from PDF files with the bundled script.',
          path: join(workspaceDir, '.coko/skills/pdf/SKILL.md'),
          scope: 'project',
          enabled: true,
          allowedTools: ['Bash(*)'],
          disableModelInvocation: false,
        },
        {
          name: 'notes',
          description: 'Take structured meeting notes. Read reference.md for the template.',
          path: join(dirs.cokoHome, 'skills/notes/SKILL.md'),
          scope: 'user',
          enabled: true,
          allowedTools: [],
          disableModelInvocation: false,
        },
        {
          name: 'lint',
          description: 'Lint the code base before committing.',
          path: join(agentsHome, 'skills/lint/SKILL.md'),
          scope: 'user',
          enabled: true,
          allowedTools: [],
          disableModelInvocation: false,
        },
      ])
      expect(res.body.diagnostics).toEqual([
        expect.objectContaining({ source: 'skills', code: 'name-mismatch', path: join(workspaceDir, '.agents/skills/wrong-name/SKILL.md') }),
        expect.objectContaining({ source: 'skills', code: 'shadowed', path: join(dirs.cokoHome, 'skills/pdf/SKILL.md') }),
      ])
      const commands = (await api.get(`${commandPaths.commands}?workspaceId=${workspace.id}`)).body.commands as {
        name: string
        source: string
        argumentHint?: string
      }[]
      expect(commands.filter((c) => c.source === 'skill').map((c) => [c.name, c.argumentHint])).toEqual([
        ['deploy', undefined],
        ['lint', undefined],
        ['notes', undefined],
        ['pdf', '<file>'],
      ])
      // 修改用户级 SKILL.md：下一次读取得到新描述（按 mtime 缓存）。
      const notes = join(dirs.cokoHome, 'skills/notes/SKILL.md')
      await writeFile(notes, (await readFile(notes, 'utf8')).replace('Take structured meeting notes.', 'Take short notes.'))
      const later = new Date(Date.now() + 5_000)
      await utimes(notes, later, later)
      const again = (await api.get(`${skillPaths.skills}?workspaceId=${workspace.id}`)).body.skills as { name: string; description: string }[]
      expect(again.find((s) => s.name === 'notes')!.description).toBe('Take short notes. Read reference.md for the template.')
      // 用户级命令模板同样在下一次读取时生效（ADR 0009：用户编写的资源每次重新读取）。
      const greet = join(dirs.cokoHome, 'commands/greet.md')
      await mkdir(dirname(greet), { recursive: true })
      await writeFile(greet, '---\ndescription: Greet v1\n---\nSay hi.\n')
      const describe1 = async () =>
        ((await api.get(`${commandPaths.commands}?workspaceId=${workspace.id}`)).body.commands as { name: string; description: string }[]).find(
          (c) => c.name === 'greet',
        )?.description
      expect(await describe1()).toBe('Greet v1')
      await writeFile(greet, '---\ndescription: Greet v2\n---\nSay hi.\n')
      await utimes(greet, later, new Date(Date.now() + 10_000))
      expect(await describe1()).toBe('Greet v2')
      expect(await api.get(skillPaths.skills)).toMatchObject({ status: 400, body: { error: { code: 'bad-request' } } })
      expect(await api.get(`${skillPaths.skills}?workspaceId=missing`)).toMatchObject({ status: 404, body: { error: { code: 'not-found' } } })
    },
  )
})
