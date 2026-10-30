// /api/sessions/:id/jobs 与 /api/jobs/:id/…（路径相对 /api）：Job 快照、日志输出（不影响模型的 job_output 游标）与停止。
import { JOB_OUTPUT_PAGE_MAX, type SessionJobsResponse } from '@coko/protocol'
import type { Application } from '../../application/index.ts'
import { AppError } from '../../application/errors.ts'
import { domainRouter } from './shared.ts'

const integer = (value: string | undefined, name: string, fallback: number) => {
  if (value === undefined || value === '') return fallback
  if (!/^\d+$/.test(value)) throw new AppError('bad-request', `${name} must be a non-negative integer`)
  return Number(value)
}

export function jobsRoutes(app: Application) {
  const { jobs } = app
  const r = domainRouter()
  r.get('/sessions/:id/jobs', async (c) => c.json({ jobs: await jobs.list(c.req.param('id')) } satisfies SessionJobsResponse))
  r.get('/jobs/:id/output', async (c) => {
    const offset = integer(c.req.query('offset'), 'offset', 0)
    const limit = integer(c.req.query('limit'), 'limit', JOB_OUTPUT_PAGE_MAX)
    if (limit < 1 || limit > JOB_OUTPUT_PAGE_MAX) throw new AppError('bad-request', `limit must be between 1 and ${JOB_OUTPUT_PAGE_MAX}`)
    return c.json(await jobs.output(c.req.param('id'), offset, limit))
  })
  r.post('/jobs/:id/kill', async (c) => {
    await jobs.kill(c.req.param('id'))
    return c.body(null, 204)
  })
  return r
}
