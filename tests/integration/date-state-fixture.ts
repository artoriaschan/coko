// Independent, fixed host-clock expectations shared by protocol tests with exact message assertions.
export const DATE_TEST_ENV = {
  TZ: 'Asia/Shanghai',
  COKO_TEST_CLOCK: '1',
  COKO_TEST_CLOCK_START: String(Date.parse('2026-11-05T12:00:00Z')),
}
export const DATE_TEST_BLOCK = '<state_update name="date">\n{\n  "date": "2026-11-05",\n  "weekday": "Thursday"\n}\n</state_update>'
