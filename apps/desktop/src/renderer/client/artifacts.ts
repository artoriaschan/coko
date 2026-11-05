import { artifactPaths, ResolveArtifactResponse, SessionArtifactsResponse } from '@coko/protocol'
import { requestJson } from './api.ts'

export const artifactsClient = {
  list: async (sessionId: string, signal: AbortSignal) =>
    (await requestJson(SessionArtifactsResponse, 'GET', artifactPaths.list(sessionId), undefined, (path, init) => fetch(path, { ...init, signal }))).artifacts,
  resolve: async (sessionId: string, path: string) => (await requestJson(ResolveArtifactResponse, 'POST', artifactPaths.resolve(sessionId), { path })).path,
}
