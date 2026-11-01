// Writes test-passed only when slugify() is correct.
import { writeFileSync } from 'node:fs'
import { slugify } from './slug.mjs'

const got = slugify('Hello Big World')
if (got !== 'hello-big-world') {
  console.error(`expected hello-big-world, got ${got}`)
  process.exit(1)
}
writeFileSync(new URL('./test-passed', import.meta.url), 'pass\n')
