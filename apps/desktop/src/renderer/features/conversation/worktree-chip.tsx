import type { SessionWorktree } from '@coko/protocol'
import { cn } from '@coko/ui'
import { IconGitBranch } from '@tabler/icons-react'
import { useI18n } from '../../app/i18n.tsx'

/**
 * 会话绑定的 worktree 的分支 chip（侧栏会话行与标题栏）。已移除的 worktree 以删除线与弱化色显示。
 * 分支名是用户内容，原样显示；完整分支名在 title 中。
 */
export function WorktreeChip({ worktree, className }: { worktree: SessionWorktree; className?: string }) {
  const { t } = useI18n()
  const removed = worktree.status === 'removed'
  return (
    <span
      data-slot="worktree-chip"
      data-worktree-id={worktree.id}
      data-worktree-status={worktree.status}
      title={t('worktrees.branch', { branch: worktree.branch })}
      className={cn(
        'inline-flex h-5 max-w-40 min-w-0 shrink items-center gap-1 rounded-xs bg-muted px-1.5 text-ui-small text-muted-foreground',
        removed && 'line-through',
        className,
      )}
    >
      <IconGitBranch aria-hidden className="size-3 shrink-0" />
      <span data-user-content className="min-w-0 truncate">
        {worktree.branch}
      </span>
    </span>
  )
}

/** worktree 已移除的会话：输入区位置的只读提示（提交会以 worktree-removed 被拒绝）。 */
export function WorktreeReadOnlyNotice({ worktree, className }: { worktree: SessionWorktree; className?: string }) {
  const { t } = useI18n()
  return (
    <div
      role="status"
      data-slot="worktree-read-only"
      className={cn(
        'flex items-center gap-2 rounded-panel border-hairline border-border bg-background px-3 py-2 text-ui-body text-muted-foreground',
        className,
      )}
    >
      <IconGitBranch aria-hidden className="size-4 shrink-0" />
      <p className="min-w-0 flex-1">{t('worktrees.readOnly', { name: worktree.name })}</p>
    </div>
  )
}
