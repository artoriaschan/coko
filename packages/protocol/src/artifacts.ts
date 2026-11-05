import { Type, type Static } from 'typebox'
import { apiPaths } from './api.ts'

const strict = { additionalProperties: false } as const
/** A current ordinary file or directory under a standalone Session's outputs. Paths use forward slashes. */
export const Artifact = Type.Object(
  {
    path: Type.String(),
    name: Type.String(),
    kind: Type.Union([Type.Literal('file'), Type.Literal('directory')]),
    size: Type.Number({ minimum: 0 }),
    modifiedAt: Type.Number(),
  },
  strict,
)
export type Artifact = Static<typeof Artifact>
export const SessionArtifactsResponse = Type.Object({ artifacts: Type.Array(Artifact) }, strict)
export type SessionArtifactsResponse = Static<typeof SessionArtifactsResponse>
export const ResolveArtifactRequest = Type.Object({ path: Type.String({ minLength: 1 }) }, strict)
export const ResolveArtifactResponse = Type.Object({ path: Type.String() }, strict)
export const artifactPaths = {
  list: (sessionId: string) => `${apiPaths.session(sessionId)}/artifacts`,
  resolve: (sessionId: string) => `${artifactPaths.list(sessionId)}/resolve`,
} as const
