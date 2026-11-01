// Writes check.ok only when add() is correct.
import { writeFileSync } from 'node:fs'
import { add } from './math.mjs'

if (add(2, 3) !== 5 || add(-1, 1) !== 0) {
  console.error('add() is wrong')
  process.exit(1)
}
writeFileSync(new URL('./check.ok', import.meta.url), 'ok\n')
