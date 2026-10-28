import { createMemoryStore } from '@coko/session/memory'
import { describeRepositoryContract } from '../repository-contract.ts'

describeRepositoryContract('内存实现', async (options) => createMemoryStore(options))
