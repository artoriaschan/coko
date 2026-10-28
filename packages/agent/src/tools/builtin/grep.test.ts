import { describeGrepContract } from '../../testing/grep-contract.ts'
import { createGrepTool } from './grep.ts'

describeGrepContract({ name: '内置纯 JS grep', createTool: (cwd) => createGrepTool({ cwd }) })
