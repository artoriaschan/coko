// The date is current Session state, separate from stable environment facts (ADR 0024).
import type { ClockPort } from '../../adapters/clock.ts'
import type { ContextContribution } from './types.ts'

export function dateContribution(clock: Pick<ClockPort, 'now'> = { now: Date.now }): ContextContribution {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
  })
  return {
    name: 'date',
    async stateValues(scope) {
      if (!scope.sessionId) return {}
      const parts = format.formatToParts(clock.now())
      const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value
      return { date: { date: `${part('year')}-${part('month')}-${part('day')}`, weekday: part('weekday') } }
    },
  }
}
