import { expect, it } from 'vitest'
import { SessionHub } from './hub.ts'

it('broadcasts statuses despite a failing connection and detaches closed connections', () => {
  const hub = new SessionHub()
  const received: unknown[] = []
  hub.subscribeBroadcasts(() => {
    throw new Error('closed socket')
  })
  const off = hub.subscribeBroadcasts((message) => received.push(message))
  hub.publishStatus('root', { running: false, agentsRunning: true })
  off()
  hub.publishStatus('root', { running: false, agentsRunning: false })
  expect(received).toEqual([{ type: 'session_status', sessionId: 'root', running: false, agentsRunning: true }])
})

it('observes progress synchronously after delivering it to subscribers', () => {
  const hub = new SessionHub()
  const order: string[] = []
  hub.subscribe('root', () => order.push('subscriber'))
  const off = hub.observeProgress((_id, event) => order.push(event.type))
  hub.publishProgress('root', 'run', { type: 'run_start' })
  off()
  hub.publishProgress('root', 'run', { type: 'run_end', status: 'completed' })
  expect(order).toEqual(['subscriber', 'run_start', 'subscriber'])
})
