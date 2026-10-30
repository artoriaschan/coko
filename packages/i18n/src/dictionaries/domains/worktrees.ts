// Worktree（ADR 0016）：侧栏菜单与分支 chip。当前只有占位文案，由 worktree 的实现补全。
import { defineDomain } from './define.ts'

export const worktrees = defineDomain(
  {
    title: 'Worktree',
  },
  {
    title: 'Worktrees',
  },
)
