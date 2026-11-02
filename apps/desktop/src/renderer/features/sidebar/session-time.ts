import type { Locale, Translator } from '@coko/i18n'

/** Search and the Session card describe the same last-record timestamp. */
export function sessionTime(at: number, now: number, locale: Locale, t: Translator): string {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000))
  if (minutes < 1) return t('sidebar.justNow')
  if (minutes < 60) return t('sidebar.minutesAgo', { count: minutes })
  if (minutes < 1440) return t('sidebar.hoursAgo', { count: Math.floor(minutes / 60) })
  if (now - at <= 7 * 86400000) return t('sidebar.daysAgo', { count: Math.floor(minutes / 1440) })
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short' }).format(at)
}
