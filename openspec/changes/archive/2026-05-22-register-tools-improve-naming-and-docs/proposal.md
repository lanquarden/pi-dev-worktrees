## Why

The extension documents `worktree_set`, `devcontainer_control`, `workspaces_status`, and `workspace_remove` as registered LLM tools, but only slash commands are actually implemented — the tools are missing. Additionally, the slash commands are fragmented into four separate registrations (`/worktree`, `/devcontainer`, `/workspaces`, `/workspace-cleanup`) when everything can be unified under two commands with sub-commands. The README mixes installation steps, optional features, and advanced internals in a way that makes getting started harder than it needs to be.

Fixing all three together ensures the documented interface matches the code, that the command surface is minimal and consistent, and that new users reach a working install without wading through optional/advanced content.

## What Changes

- **Register a `worktree` tool** via `pi.registerTool()` with an `action` parameter (`"set"`, `"off"`, `"prune"`, `"status"`, `"remove"`) — `branch` is required for `set` and `remove`, not present for the others — the LLM can call it in a single turn for full worktree lifecycle management.
- **Register a `devcontainer` tool** via `pi.registerTool()` with an `action` parameter (`"on"`, `"off"`, `"rebuild"`, `"logs"`) — mirrors the existing command.
- **Collapse `/workspaces` and `/workspace-cleanup`** into `/worktree status` and `/worktree remove <branch>` respectively. `/worktree [set] <branch>` keeps the bare-branch form as the default action so existing TUI muscle-memory is preserved.
- **Drop `/workspaces` and `/workspace-cleanup`** — no aliases, clean break at this early stage.
- **Overhaul README**: installation first, split into "pi Extension" and "Dashboard Plugin" sections, mark `pi-rtk-optimizer` clearly as optional, simplify its instructions, update all links.

## Capabilities

### New Capabilities
- `registered-tools`: LLM-callable `worktree` and `devcontainer` tools registered via `pi.registerTool()` with `action`-dispatched parameters.

### Modified Capabilities
- `workspaces-modal`: Dashboard modal trigger changes from `command: "/workspaces"` to `command: "/worktree status"` to reflect the collapsed command surface.

## Impact

- `packages/pi-dev-worktrees/src/index.ts` — add `pi.registerTool()` calls; collapse `/workspaces` and `/workspace-cleanup` into `/worktree` sub-commands; remove the two standalone command registrations.
- `packages/pi-dev-worktrees/src/dashboard-ui.ts` (or equivalent) — update modal `command` field.
- `README.md` — structural rewrite; no behavior changes.
- TUI users relying on `/workspaces` or `/workspace-cleanup` will see "command not found" — acceptable at this stage.
