/**
 * Credential port. The host implements pi-ai's CredentialStore (the Sidecar backs it with the
 * encrypted ProviderRepository and main's safeStorage, ADR 0004). Keys are Provider ids.
 */
export type { ApiKeyCredential, Credential, CredentialInfo, CredentialStore } from '@earendil-works/pi-ai'
export { InMemoryCredentialStore } from '@earendil-works/pi-ai'
