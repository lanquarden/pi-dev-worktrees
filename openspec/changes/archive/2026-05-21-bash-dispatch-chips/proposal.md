## Why

When pi-dev-worktrees is active, every bash command is routed — either run on the host directly or wrapped in `devcontainer exec`. When pi-rtk-optimizer is active, commands may be rewritten before routing. The dashboard's bash tool card shows only the original LLM command with no indication of what actually ran or where.

This change makes pi-dev-worktrees emit a structured pi event from the `tool_call` handler after routing, so the dashboard can render chips for routing context and RTK rewrites on the bash tool card.

## What Changes

- **`tool_execution_start` hook**: capture original LLM command (pre-RTK) by `toolCallId`
- **`tool_call` handler**: after `applyBashIntercept`, emit `pi.events.emit("pi-dev-worktrees:bash-dispatch", payload)` with routing metadata

No `tool_result` changes. No bridge dependency. Uses existing `pi.events.emit` forwarding.

## Impact

- **Files**: `packages/pi-dev-worktrees/src/index.ts`
- **Tests**: `tests/bash-dispatch-emit.test.ts` (new)
