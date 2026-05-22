## Why

The extension documents `worktree_set`, `devcontainer_control`, `workspaces_status`, and `workspace_remove` as registered LLM tools, but only slash commands are actually implemented — the tools are missing. Additionally, slash command naming is inconsistent (`/workspaces` vs `/workspace-cleanup`) and the README mixes installation steps, optional features, and advanced internals in a way that makes getting started harder than it needs to be.

Fixing all three together ensures the documented interface matches the code, that command names are predictable, and that new users reach a working install without wading through optional/advanced content.

## What Changes

- **Register `worktree_set`, `devcontainer_control`, `workspaces_status`, and `workspace_remove`** as `pi.registerTool()` entries so the LLM can call them in a single turn without needing sequential slash commands.
- **Rename slash commands** for consistent naming: `/workspace` (was `/worktree`), `/workspaces` (unchanged), `/workspace-remove` (was `/workspace-cleanup`) — aligns all commands under the `workspace` prefix.
- **Overhaul README**: split into a pi-extension section and a pi-agent-dashboard-plugin section, move installation to the top, clearly mark `pi-rtk-optimizer` as optional, simplify its instructions, and update all links.

## Capabilities

### New Capabilities
- `registered-tools`: LLM-callable tools (`worktree_set`, `devcontainer_control`, `workspaces_status`, `workspace_remove`) registered via `pi.registerTool()` alongside the existing slash commands.

### Modified Capabilities
- `workspaces-modal`: Rename `/workspace-cleanup` → `/workspace-remove` and `/worktree` → `/workspace` for consistent naming across all slash commands.

## Impact

- `packages/pi-dev-worktrees` — add `pi.registerTool()` calls; update slash command names in the command handler registrations.
- `README.md` — structural rewrite; no behavior changes.
- Any callers using the old slash command names will need to update (breaking rename, TUI only).
