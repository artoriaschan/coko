/**
 * Test helpers for packages/agent and its hosts. Imports vitest: use only from test files.
 */
export { describeGrepContract } from './grep-contract.ts'
export type { GrepContractOptions } from './grep-contract.ts'
export { createFauxModels, fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall } from './faux.ts'
export type { FauxProviderHandle, FauxResponseStep } from './faux.ts'
export { isProcessAlive, readPids, waitFor } from './process.ts'
export { createTempWorkspace } from './workspace.ts'
export type { TempWorkspace } from './workspace.ts'
