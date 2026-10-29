// 指令文件的夹具（票 03）：仓库（含 .git）里的 Workspace 子目录、用户级 COKO_HOME 与 @import。只写入调用方给的临时目录。
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, content] of Object.entries(files)) {
    const path = join(root, relative)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
  }
}

/**
 * <root>/outside.md（仓库之外）、<root>/repo（.git、AGENTS.md 引入 docs/style.md 与 ../outside.md）、
 * <root>/repo/app（Workspace，只有 CLAUDE.md）、<root>/repo/app/pkg/AGENTS.md（嵌套，开始时不加载）。返回 Workspace 路径。
 */
export async function writeLayeredRepo(root: string): Promise<{ repo: string; workspace: string }> {
  await writeTree(root, {
    'outside.md': 'OUTSIDE-MARKER',
    'repo/.git/HEAD': 'ref: refs/heads/main\n',
    'repo/AGENTS.md': '# Repo\nREPO-RULE\nStyle: @./docs/style.md\nNot this: @../outside.md\n\n```\n@./docs/fenced.md\n```\n',
    'repo/docs/style.md': 'STYLE-RULE\n',
    'repo/docs/fenced.md': 'FENCED-MARKER\n',
    'repo/app/CLAUDE.md': 'APP-RULE-V1\n',
    'repo/app/pkg/AGENTS.md': 'PKG-RULE\n',
    'repo/app/pkg/a.ts': 'export const a = 1\n',
    'repo/app/pkg/b.ts': 'export const b = 2\n',
  })
  return { repo: join(root, 'repo'), workspace: join(root, 'repo', 'app') }
}
