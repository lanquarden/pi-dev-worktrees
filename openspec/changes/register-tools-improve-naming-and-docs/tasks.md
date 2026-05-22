## 1. Refactor shared logic for tool/command reuse

- [ ] 1.1 Extract worktree operation logic from the `/worktree` command handler into a standalone `handleWorktreeSet(branch, pi, state)` function in `worktrees.ts`
- [ ] 1.2 Extract devcontainer operation logic from the `/devcontainer` command handler into a standalone `handleDevcontainerControl(action, pi, state)` function in `devcontainer.ts`
- [ ] 1.3 Extract workspace status snapshot logic into a standalone `getWorkspacesStatus(state)` function
- [ ] 1.4 Extract workspace remove logic into a standalone `handleWorkspaceRemove(branch, state)` function
- [ ] 1.5 Update existing command handlers to call the extracted functions (no behavior change)

## 2. Register LLM-callable tools

- [ ] 2.1 Register `worktree_set` via `pi.registerTool()` with input schema `{ branch: string }` delegating to `handleWorktreeSet`
- [ ] 2.2 Register `devcontainer_control` via `pi.registerTool()` with input schema `{ action: "on" | "off" | "rebuild" }` delegating to `handleDevcontainerControl`
- [ ] 2.3 Register `workspaces_status` via `pi.registerTool()` with no required input delegating to `getWorkspacesStatus`
- [ ] 2.4 Register `workspace_remove` via `pi.registerTool()` with input schema `{ branch: string }` delegating to `handleWorkspaceRemove`

## 3. Rename slash commands

- [ ] 3.1 Rename `pi.registerCommand("worktree", ...)` → `pi.registerCommand("workspace", ...)` in `index.ts`
- [ ] 3.2 Rename `pi.registerCommand("workspace-cleanup", ...)` → `pi.registerCommand("workspace-remove", ...)` in `index.ts`
- [ ] 3.3 Update any internal cross-references (e.g. help text, log messages) from `/worktree` → `/workspace` and `/workspace-cleanup` → `/workspace-remove`
- [ ] 3.4 Update tests that reference the old command names

## 4. Update documentation

- [ ] 4.1 Restructure README: add installation section at the top with `pi install` instructions
- [ ] 4.2 Split README into two sections: "pi Extension" and "Dashboard Plugin"
- [ ] 4.3 Mark `pi-rtk-optimizer` clearly as optional; simplify its setup instructions
- [ ] 4.4 Update Features list to reflect renamed commands (`/workspace`, `/workspace-remove`)
- [ ] 4.5 Add migration note: `/worktree` → `/workspace`, `/workspace-cleanup` → `/workspace-remove`
- [ ] 4.6 Update/add links (issue #4: fix broken or missing links)

## 5. Bump version

- [ ] 5.1 Bump `packages/pi-dev-worktrees/package.json` version (minor bump for breaking rename)
- [ ] 5.2 Bump `packages/pi-dev-worktrees-dashboard-plugin/package.json` version if dashboard plugin references renamed commands
