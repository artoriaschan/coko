export declare const GIT_FIXTURE_AUTHOR: {
  readonly name: 'Coko Fixture'
  readonly email: 'fixture@coko.test'
}
/** 固定的提交时间（author 与 committer）。 */
export declare const GIT_FIXTURE_DATE = '2026-01-01T00:00:00Z'
export interface GitWorkspace {
  /** 仓库根（真实路径）。 */
  root: string
  /** 临时 HOME。 */
  home: string
  /** 交给 Sidecar 与 git 的环境。 */
  env: Record<string, string>
  /** 在仓库中运行 git，返回 stdout。 */
  git(...args: string[]): Promise<string>
  dispose(): Promise<void>
}
export declare function createGitWorkspace(options?: { files?: Record<string, string> }): Promise<GitWorkspace>
