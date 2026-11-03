---
kind: evidence
description: "完全关闭后重开历史组的确定性回归与独立诊断。"
lifecycle: active
---

# Completed group reopen scroll diagnosis

Base: `f31dd346b7378223d3c11a6a562084963487ec8c`.
Isolated worktree: `/tmp/coko-conversation-detail/reopen-diagnosis`.
Branch: `codex/conversation-detail-reopen-diagnosis`.
Delivered commit: `1b6d4070ebfdc8afaa5dd7da7840c9065e1b00bd`; clean worktree after commit. Commit hooks also passed oxfmt and oxlint for the two source/test files.

## Result

This is a visible product bug on fully completed close/reopen, not an assertion against hidden or transitional geometry. After reopening finishes, the body has `clientHeight === 400`, computed `overflowY === 'auto'`, and the old nonzero scroll position remains. An 80ms interrupted closing reversal does not take this path.

The manual initialize-top request was consumed in Group's layout effect while `bodyHidden === true` and the actual DOM `hidden` property was still true. `useFlowBox` requests removal of hidden in a subsequent render. Resetting a display:none element cannot replace its retained native scroll position. When the layout box returns, Chromium restores the retained position.

The fix preserves the pending initialize-top request until `bodyHidden` becomes false. It changes no reader anchoring/follow, gesture, focus, animation duration, or overflow logic.

## Reproduction and minimization

Pristine exact two-file public command first passed 26/26 in this worktree; 13's retained evidence recorded the same public command failing 25/26 with scrollTop 496. The original two clicks do not guarantee completed closing; the explicit completion barrier below isolates that untested path, while the existing controlled 80ms reversal cases stay green.

Adding only `await expect.poll(() => group.hidden).toBe(true)` between the existing close and reopen clicks establishes a completion barrier rather than a delay. The unchanged strict final `scrollTop === 0` assertion then fails standalone at 496. Command:

```sh
rtk proxy pnpm run test --project desktop-renderer apps/desktop/src/renderer/features/conversation/reading-position.browser.test.tsx -t 'a capped group'
```

One element removed per diagnostic run:

1. Remove outer held-reader scrolling: still fails 496.
2. Remove detail expansion/growth: still fails 268.
3. Remove all preceding assistant replies: still fails 268.
4. Reduce collapsed tools from 24 to 15, the smallest count exceeding the 400px cap: still fails 16.

Thus outer anchor replay, detail focus, streamed growth, and earlier history are not required. A tagged log reading only React/DOM hidden state at reset consumption reported `{bodyHidden: true, domHidden: true}` for both first open and full reopen; the minimal test still failed 16. No scrollTop property interception or additional layout probe was needed. All minimization and tagged instrumentation were restored before delivery.

## Ranked predictions tested

1. Completed-close display:none reset consumption: explicit hidden-completion barrier should turn a standalone green into red; confirmed.
2. Outer anchor replay: removing the held outer reader should remove red; falsified.
3. Focus/actionability native scroll: DOM clicks versus Playwright clicks would change verdict. Not needed after the lifecycle trace and minimal fix; expanded-detail focus itself was removed from the red repro.
4. Stale following ownership after ResizeObserver growth: trace follow/reset ordering would show a post-reset writer. Not needed after the lifecycle trace and minimal fix; detail growth itself was removed from the red repro.

## Regression and verification

Retained source changes: `process-timeline.tsx` gates reset on `!bodyHidden`; the existing capped-group browser regression now waits for completed close before reopening. Original strict zero assertion retained.

- `pnpm install --frozen-lockfile`: exit 0; lock unchanged.
- Standalone full-close regression before product fix: 1 failed, 18 skipped; expected 0, received 496; `/tmp/coko-conversation-detail/reopen-red.log`.
- Same regression after product fix: 1 passed, 18 skipped; `/tmp/coko-conversation-detail/reopen-green.log`.
- `rtk proxy pnpm run test --project desktop-renderer apps/desktop/src/renderer/features/conversation/integrated-detail.browser.test.tsx apps/desktop/src/renderer/features/conversation/reading-position.browser.test.tsx`: exit 0, 26/26; `/tmp/coko-conversation-detail/reopen-two-file.log`. Includes controlled 80ms close/reopen and reading/gesture/focus cases.
- `rtk proxy pnpm run test --project desktop-renderer apps/desktop/src/renderer/features/conversation/process-groups.browser.test.tsx`: exit 0, 21/21; `/tmp/coko-conversation-detail/reopen-groups.log`.
- `rtk proxy pnpm run typecheck`: exit 0; `/tmp/coko-conversation-detail/reopen-typecheck.log`.
- `rtk proxy pnpm run format:check apps/desktop/src/renderer/features/conversation/process-timeline.tsx apps/desktop/src/renderer/features/conversation/reading-position.browser.test.tsx`: exit 0.
- `rtk proxy pnpm run lint apps/desktop/src/renderer/features/conversation/process-timeline.tsx apps/desktop/src/renderer/features/conversation/reading-position.browser.test.tsx`: exit 0.
- `git diff --check`: exit 0. No DEBUG-reopen instrumentation remains. No persistent app/server was launched; completed Vitest processes exited.

Validation scope is Chromium Browser Mode and local TypeScript/static checks. Electron native/real-pointer acceptance, full-suite current-source verification, hosted CI and integration remain with ticket 13/root.
