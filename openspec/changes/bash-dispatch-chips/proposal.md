## Why

When pi-dev-worktrees is active, every bash command is routed — either run on the host directly or wrapped in `devcontainer exec` and run inside a container. When pi-rtk-optimizer is active, commands may be rewritten (e.g. `grep` → `rtk grep`) before routing. The dashboard's bash tool card shows only the original LLM command with no indication of what actually ran or where.

This change makes pi-dev-worktrees emit a structured `bash-dispatch` prompt_request from the `tool_call` handler immediately after routing, so the dashboard can render an in-flight replacement card with routing and RTK chips while the command is executing.

The companion change in pi-agent-dashboard (`openspec/changes/bash-dispatch-chips/`) provides the renderer, bridge opts alignment, and plugin runtime export.

## What Changes

- **`tool_execution_start` hook**: capture original LLM command (pre-RTK) by `toolCallId` before any extension mutation
- **`tool_call` handler**: after `applyBashIntercept`, emit `bash-dispatch` dispatch notification via `ctx.ui.notify` with `toolCallId` and structured props — gives the dashboard an immediate in-flight signal
- No `tool_result` changes needed: the suppression mechanism auto-dismisses the chip card when the tool completes

## Impact

- **Files**: `packages/pi-dev-worktrees/src/index.ts`
- **Tests**: `tests/bash-dispatch-emit.test.ts` (new) — dispatch metadata assertions
