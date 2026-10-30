// POST /api/test/clock（路径相对 /api）：拨快或设定测试时钟。只在测试时钟开启（测试构建、未 --packaged 且 COKO_TEST_CLOCK=1）时挂载，
// 产品装配与打包产物没有这个路由（404）。
import { TestClockRequest, type TestClockResponse } from '@coko/protocol'
import type { TestClock } from '../../adapters/clock.ts'
import { AppError } from '../../application/errors.ts'
import { body, domainRouter } from './shared.ts'

export function testClockRoutes(clock: TestClock) {
  const r = domainRouter()
  r.post('/test/clock', async (c) => {
    const request = await body(c, TestClockRequest)
    let now: number
    try {
      now = 'advanceMs' in request ? clock.advance(request.advanceMs) : clock.set(request.setMs)
    } catch (error) {
      throw new AppError('bad-request', error instanceof Error ? error.message : String(error))
    }
    return c.json({ now } satisfies TestClockResponse)
  })
  return r
}
