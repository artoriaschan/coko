// File Reference（@ 引用）：token 解析、展开为 <file_reference> 文本块、Workspace 文件候选。
export { formatFileReferenceToken, parseFileReferences, parseSessionReferences, type FileReferenceToken, type SessionReferenceToken } from './parse.ts'
export {
  expandFileReferences,
  FILE_REFERENCE_DIRECTORY_LIMIT,
  FILE_REFERENCE_MAX_COUNT,
  FILE_REFERENCE_MESSAGE_BYTES,
  FILE_REFERENCE_NOTES,
  type ExpandedFileReference,
  type ExpandedFileReferences,
  type ExpandedSessionReference,
  type ExpandFileReferencesOptions,
  type SessionReferenceResolution,
  type FileReferenceStatus,
} from './expand.ts'
export { SESSION_REFERENCE_MAX_BYTES, SESSION_REFERENCE_NOTES, sessionReferenceBlock, sessionTranscript, type SessionTranscript } from './session.ts'
export { FILE_SEARCH_LIMIT, searchWorkspaceFiles, type WorkspaceFileEntry } from './search.ts'
