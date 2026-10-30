// 后台任务 store 的 HTTP 后端：错误体在信任边界按 ErrorResponse 校验（与 goal-store 相同）。
import { describe, expect, it } from 'vitest'
import { ApiError } from '../client/api.ts'
import { httpJobsBackend } from './jobs-store.ts'

const respond = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('httpJobsBackend 的错误体', () => {
  it('合法的错误体：code、message 与 details 原样交给调用方', async () => {
    const backend = httpJobsBackend(respond(409, { error: { code: 'job-not-running', message: 'ended', details: { jobId: 'j1' } } }))
    await expect(backend.kill('j1')).rejects.toMatchObject({ code: 'job-not-running', message: 'ended', status: 409, details: { jobId: 'j1' } })
  })

  it('code 不是协议中的错误码：bad-response，不把任意字符串当作错误码', async () => {
    const backend = httpJobsBackend(respond(500, { error: { code: 'made-up', message: 'x' } }))
    const error = await backend.list('s1').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ code: 'bad-response', status: 500 })
  })
})
