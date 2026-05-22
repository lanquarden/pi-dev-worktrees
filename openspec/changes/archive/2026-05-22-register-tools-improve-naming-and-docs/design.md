## Context

The extension registers four slash commands and documents four LLM tools — but the tools are never registered. The commands are also fragmented: `/workspaces` and `/workspace-cleanup` are standalone registrations that overlap conceptually with `/worktree`. The `args` parameter in `registerCommand` handlers is a raw string, so sub-command dispatch is already done manually inside the `/worktree` handler (e.g. `"hooks add"`, `"prune"`, `"init"`). Extending this pattern to absorb `status` and `remove` is zero-cost.

`pi.registerTool()` accepts TypeBox schemas and dispatches to an `execute()` function — the `action` + optional `branch` pattern maps cleanly onto both tools.

The dashboard modal in `workspaces-modal` hardcodes `command: "/workspaces"` as the trigger. This needs updating when the command is removed.

## Goals / Non-Goals

**Goals:**
- Register `worktree` and `devcontainer` as LLM-callable tools via `pi.registerTool()`.
- Collapse `/workspaces` and `/workspace-cleanup` into `/worktree status` and `/worktree remove` sub-commands.
- Keep `/worktree <branch>` (bare-branch form) working — `set` is optional, branch is the default action.
- Add a confirmation prompt before removing a worktree in TUI (`/worktree remove`).
- Update the dashboard modal command reference from `/workspaces` → `/worktree status`.
- Restructure README.

**Non-Goals:**
- Changing worktree or devcontainer behavior/semantics.
- Backward-compat aliases for `/workspaces` or `/workspace-cleanup`.
- Introducing tools beyond `worktree` and `devcontainer`.

## Decisions

**D1 — Two action-dispatched tools, not four narrow tools**
`worktree(action, branch?)` and `devcontainer(action)` give the LLM a single coherent mental model per subsystem. Avoids tool-list pollution. The LLM already understands that `/worktree` does multiple things — a single tool mirrors that.
*Alternative: one tool per operation* — more discoverable in isolation, but unnecessary complexity here.

**D2 — `set` is optional in TUI; `branch` alone implies `set`**
`/worktree feature/auth` continues to work. `/worktree set feature/auth` also works. Handler checks: if arg doesn't match any known sub-command keyword and isn't empty, treat it as a branch name (existing behavior).
*Alternative: require explicit `set`* — cleaner but breaks TUI muscle-memory for no gain.

**D3 — Confirmation prompt before `worktree remove` in TUI**
The existing `/workspace-cleanup` was interactive. `/worktree remove <branch>` should prompt `"Remove worktree <branch>? Uncommitted changes will be lost."` before proceeding. Tools (LLM path) skip the prompt — the LLM is responsible for confirming intent.
*Alternative: no prompt, immediate removal* — acceptable for tools but too abrupt for TUI.

**D4 — Dashboard modal command: `/workspaces` → `/worktree status`**
Simple string change in `dashboard-ui.ts`. No behavioral difference.

**D5 — Extract shared logic before registering tools**
Both the command handler and the tool `execute()` function need the same operations. Extract `doWorktreeSet`, `doWorktreeRemove`, `doWorktreeStatus`, `doDevcontainerAction` as internal helpers, then call them from both paths. Keeps logic in one place.

## Risks / Trade-offs

- [Breaking removal of `/workspaces` and `/workspace-cleanup`] → Acceptable at this early stage; documented in README migration note.
- [Tool `action` enum — LLM may hallucinate invalid values] → TypeBox enum validation will reject invalid values before `execute()` runs; handler returns a clear error.
- [Dashboard modal stops working until `dashboard-ui.ts` is updated] → Both changes are in the same PR, so no window where one is deployed without the other.

## Migration Plan

1. Extract shared operation helpers.
2. Add `pi.registerTool("worktree", ...)` and `pi.registerTool("devcontainer", ...)`.
3. Extend `/worktree` handler with `status` and `remove` sub-commands (with confirmation).
4. Remove `pi.registerCommand("workspaces", ...)` and `pi.registerCommand("workspace-cleanup", ...)`.
5. Update dashboard modal `command` field.
6. Rewrite README.
7. Bump minor version.

## Open Questions

None — all decisions resolved during exploration.
