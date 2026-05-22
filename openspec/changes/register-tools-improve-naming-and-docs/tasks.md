## 1. Extract shared operation helpers

- [x] 1.1 Extract worktree set/switch logic into a `doWorktreeSet(branch, pi, state)` helper in `worktrees.ts`
- [x] 1.2 Extract worktree remove logic into a `doWorktreeRemove(branch, state)` helper in `worktrees.ts`
- [x] 1.3 Extract worktree status snapshot logic into a `doWorktreeStatus(state)` helper
- [x] 1.4 Extract devcontainer action logic into a `doDevcontainerAction(action, pi, state)` helper in `devcontainer.ts`
- [x] 1.5 Update the existing `/worktree` and `/devcontainer` command handlers to call the new helpers (no behavior change)

## 2. Register LLM-callable tools

- [x] 2.1 Register `worktree` tool via `pi.registerTool()` using a TypeBox discriminated union: `{ action: "set", branch: string }` | `{ action: "remove", branch: string }` | `{ action: "off" | "prune" | "status" }` — `branch` is required for `set` and `remove`, not present for the rest; delegate to shared helpers
- [x] 2.2 Register `devcontainer` tool via `pi.registerTool()` with `action: StringEnum(["on","off","rebuild","logs"])`, delegating to `doDevcontainerAction`
- [ ] 2.3 Verify both tools are callable in a single LLM turn alongside `bash` (manual test: single prompt that chains worktree set + devcontainer on + bash)

## 3. Extend /worktree with status and remove sub-commands

- [x] 3.1 Add `status` sub-command to the `/worktree` handler — calls `doWorktreeStatus()` and notifies TUI
- [x] 3.2 Add `remove <branch>` sub-command to the `/worktree` handler — prompts for confirmation via `ctx.ui.confirm()` before calling `doWorktreeRemove()`
- [x] 3.3 Add `set <branch>` as an explicit alias — parse `arg.startsWith("set ")` and strip prefix before falling through to the existing branch-handling path
- [x] 3.4 Add usage message for `/worktree remove` called without a branch argument

## 4. Remove /workspaces and /workspace-cleanup

- [x] 4.1 Delete `pi.registerCommand("workspaces", ...)` from `index.ts`
- [x] 4.2 Delete `pi.registerCommand("workspace-cleanup", ...)` from `index.ts`
- [x] 4.3 Update any internal references (help text, log messages, comments) that mention these commands

## 5. Update dashboard modal command reference

- [x] 5.1 Change `command: "/workspaces"` → `command: "/worktree status"` in the dashboard UI module (likely `dashboard-ui.ts`)
- [ ] 5.2 Verify the modal still opens correctly via the dashboard after the change

## 6. Update documentation

- [x] 6.1 Restructure README: move installation to the top as its own section
- [x] 6.2 Split README into "pi Extension" and "Dashboard Plugin" H2 sections
- [x] 6.3 Update Features list: replace `/workspaces` and `/workspace-cleanup` with `/worktree status` and `/worktree remove`; document `set` as optional
- [x] 6.4 Mark `pi-rtk-optimizer` clearly as optional; simplify its setup instructions
- [x] 6.5 Add migration note: `/workspaces` → `/worktree status`, `/workspace-cleanup` → `/worktree remove <branch>`
- [x] 6.6 Fix broken or missing links (issue #4)

## 7. Bump version

- [x] 7.1 Bump `packages/pi-dev-worktrees/package.json` to next minor version (breaking removal of two commands)
- [x] 7.2 Check whether `packages/pi-dev-worktrees-dashboard-plugin/package.json` needs a version bump
