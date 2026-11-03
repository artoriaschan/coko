# IME aggregate focus diagnosis — no confirmed cause

## Provenance

- Independent worktree: `/tmp/coko-conversation-detail/ime-diagnosis` (`/private/tmp/...` physical path).
- Branch: `codex/conversation-detail-ime-diagnosis`.
- Source: `d3108d05673adbe3725160b3486e7897f958ffe5`, unchanged during baseline runs. This is ticket12 committed tree before its later focused-tail changes.
- Runtime: Node v26.10.0, pnpm 12.15.0. `rtk proxy pnpm install --frozen-lockfile` passed.
- Original evidence READ ONLY: `/tmp/coko-conversation-detail/ticket-12/.scratch/conversation-detail/evidence/12/renderer-final.log`, SHA256 `8cd43f5d8e7ca6ddd11d5d675ae33abebada9af48a9e30a28a9fa2fb939d5ea7`.
- Original standalone evidence READ ONLY: adjacent `new-chat-standalone.log`, SHA256 `ef5c28a6b4de2c0c46b9d70e2b2bf060ffe57cfb0dc741404986f6b39c5ad877`.
- Neither source/evidence in active ticket12 worktree was edited.

## Exact original symptom

38-file aggregate: 305 passed / 1 failed. In light destination-menu test, after synthetic compositionstart and real keyboard ArrowDown/Escape, line161 expected Search focus but sidebar Project web button was focused. Original menu input remained in DOM. Standalone source log passed11/11.

## Ranked hypotheses communicated before probes

1. Residual real pointer / delayed hover popup overlaps menu, so Escape returns focus to sidebar. Prediction: explicit controlled pointer state changes verdict; focus stack passes ProjectRow hover-card escape.
2. Composition guard timing. Prediction: Search keydown sees composing false despite compositionstart; native direct key dispatch differs from RPC keyboard.
3. Escape is intercepted by an ancestor/global Radix layer before Search stopPropagation. Prediction: native capture handler steals focus while Search composing true.
4. Late prior-modal cleanup focuses sidebar. Prediction: focus stack lies outside menu keyboard handling and follows prior resource cleanup.

These are candidates, not findings. No red-capable deterministic feedback loop was established, so no cause was selected and no fix proposed.

## Actual runs

All commands were run from independent worktree via RTK, raw stdout/stderr redirected outside repository.

1. `rtk proxy pnpm run test --project desktop-renderer apps/desktop/src/renderer/features/conversation/new-chat.browser.test.tsx apps/desktop/src/renderer/features/conversation/reading-position.browser.test.tsx`
   - `/tmp/coko-conversation-detail/ime-pair-baseline.log`
   - **2 files / 26 tests passed**, 10.69s. Exact original IME assertion retained.
2. `rtk proxy pnpm run test --project desktop-renderer apps/desktop/src/renderer/features/conversation apps/desktop/src/renderer/features/right-panel apps/desktop/src/renderer/app/app.browser.test.tsx`
   - `/tmp/coko-conversation-detail/ime-aggregate-baseline.log`
   - **38 files / 306 tests passed**, 20.68s. Same file-scope command as original failure.
3. Temporary probe (single changed preceding sequence): hover sidebar web, focus destination trigger, keyboard Enter, then await Project details before original menu/IME assertions.
   - `rtk proxy pnpm run test --project desktop-renderer apps/desktop/src/renderer/features/conversation/new-chat.browser.test.tsx -t "light：归属菜单"`
   - `/tmp/coko-conversation-detail/ime-hover-keyboard-probe.log`: failed waiting getByRole Project details (20.95s). This did **not** reach IME assertion.
   - Corrected observation to direct DOM presence to avoid modal aria-hidden obscuring role queries, same input sequence.
   - `/tmp/coko-conversation-detail/ime-hover-keyboard-dom-probe.log`: failed waiting details DOM existence (2.02s). This did **not** reach IME assertion.
   - Probe diff retained outside repo at `/tmp/coko-conversation-detail/ime-hover-keyboard-probe.diff`; source restored byte-for-byte from external pristine copy.

## Source observations and limits

- DestinationBar uses a synchronous ref for compositionstart/end. Search onKeyDown stops propagation while composing; content onEscapeKeyDown prevents default while composing.
- ProjectRow.tsx `RowHoverCardContent.onEscapeKeyDown` (around388) prevents default and unconditionally calls `focusRow()`, which focuses the Project row. This matches the *shape* of the received element but is **not causal evidence** for this run.
- No direct evidence of leaked observer/listener/WAAPI work was obtained; none is assumed.
- Controlled hover+keyboard sequence did not establish concurrent hovercard/menu. Neither isolated green run proves the original aggregate race resolved.
- Test order/pointer timing from the original failing process was not captured. No failing focus stack or native event trace is available.

## Cleanup and disposition

Temporary source modifications and tagged probe log removed from repo; no production changes, tests, commits, or global serialisation introduced. No sleep, fixed wait, retry loop, timeout increase, weakened assertion, foreground UI, or no-op polling used. Existing operation sessions completed.

**Result:** unable to build a reliable red loop from supplied evidence. Preserve original aggregate failure as unresolved intermittent evidence. Capturing targeted focus/native Escape + composition + hovercard state in a future naturally failing aggregate run is the next useful step; guessing a guard change is unsupported.

Final cleanup proof: `git status --porcelain=v1` empty; `git diff --exit-code` passed. Restored new-chat test SHA256 equals pristine `eca817d9d1fcd59d1f97279769948871f8c95b5796a8ef45befd9d702bea4450`. Process inventory showed no live vitest, playwright Chromium, or ime-diagnosis-owned command apart from inventory itself. No commit created.
