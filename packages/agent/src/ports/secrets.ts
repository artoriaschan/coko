/**
 * Secrets port (grilling B3): a tool declares the names it needs (`CokoTool.secrets`); the host resolves them for
 * each call and the runtime passes only those to that call (`ToolExecutionContext.secrets`). Values never enter
 * Session Entries, progress events or logs; other calls, including bash, do not see them.
 */
export interface SecretProvider {
  /** The value of one secret, or undefined when the host has none under that name. */
  get(name: string): string | undefined | Promise<string | undefined>
}

/** A declared secret the host cannot provide; the call does not run. The message names the secret, never a value. */
export class MissingSecretError extends Error {
  override readonly name = 'MissingSecretError'
  readonly secret: string
  constructor(secret: string, toolName: string) {
    super(`Missing secret ${secret} declared by tool ${toolName}`)
    this.secret = secret
  }
}

/** Resolve the declared secrets of one call. Undefined when the tool declares none. */
export async function resolveSecrets(
  toolName: string,
  names: readonly string[] | undefined,
  provider: SecretProvider | undefined,
): Promise<Record<string, string> | undefined> {
  if (!names || names.length === 0) return undefined
  const secrets: Record<string, string> = {}
  for (const name of names) {
    const value = await provider?.get(name)
    if (value === undefined) throw new MissingSecretError(name, toolName)
    secrets[name] = value
  }
  return secrets
}
