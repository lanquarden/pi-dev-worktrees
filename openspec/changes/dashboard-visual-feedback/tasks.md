## 1. Package Setup

- [x] 1.1 Add `@blackbelt-technology/pi-dashboard-shared` as a devDependency in `package.json`
- [x] 1.2 Run `npm install` to update `package-lock.json`

## 2. New `dashboard-ui.ts` Module

- [x] 2.1 Create `dashboard-ui.ts` with `registerDashboardUi(pi: ExtensionAPI)` export
- [x] 2.2 Implement `buildFooterText(state: WorktreesState): string | null` — returns the
       formatted segment text or null when both worktree and devcontainer are inactive
- [x] 2.3 Implement the `ui:list-modules` listener: push `footer-segment` descriptor
       (or `removed: true`) and `management-modal` descriptor for the workspaces table
- [x] 2.4 Define the `management-modal` view: table with columns `branch`, `path`, `age`,
       `dirty`; rowKey `"branch"`; `dataEvent "workspaces:list"`; rowActions with
       `remove` action (danger, confirm text, event `workspaces:delete-row`)
- [x] 2.5 Implement `workspaces:list` handler — build rows from `wtp list --quiet` output,
       falling back to `enumerateWorktreeDirs`; compute `age` and `dirty` per row;
       populate `data.items` synchronously; use 3-second timeout on all `execSync` calls
- [x] 2.6 Implement `workspaces:delete-row` handler — read `data.branch`, probe dirty flag,
       call `wtp remove [--force] <branch>`, clear `state.worktree` if it matches,
       save state, emit `ui:invalidate`
- [x] 2.7 Export `invalidateDashboardUi(pi: ExtensionAPI)` — calls
       `pi.events.emit("ui:invalidate", { id: "workspace-state" })`

## 3. Patch `dashboard-events.ts`

- [x] 3.1 Import `invalidateDashboardUi` from `./dashboard-ui.js`
- [x] 3.2 In `emitStateUpdate`, call `invalidateDashboardUi(pi)` after the existing
       `pi.events.emit("pi-dev-worktrees:state", state)` call

## 4. Patch `index.ts`

- [x] 4.1 Import `registerDashboardUi` from `./dashboard-ui.js`
- [x] 4.2 Call `registerDashboardUi(pi)` in the extension entry function, after command
       registration (end of the exported default function)

## 5. Verification

- [x] 5.1 Start a pi session in this repo, open the dashboard, confirm
       no footer segment shows on the session card initially
- [x] 5.2 Run `/worktree feature/test` — confirm the footer segment appears on the card
       showing `⎇ feature/test`
- [x] 5.3 Run `/devcontainer on` (if devcontainer config available) — confirm footer
       updates to show both branch and container state
- [x] 5.4 Type `/workspaces` in the dashboard chat input — confirm the management modal
       opens with the worktree table
- [x] 5.5 Use the Remove action on a test worktree — confirm the row disappears and the
       footer segment updates
- [x] 5.6 Run `/worktree off` — confirm the footer segment disappears from the card
- [x] 5.7 Verify a plain pi TUI session (no dashboard) still works normally

## 6. Commit

- [x] 6.1 Commit all changes with message: `feat: dashboard visual feedback — footer segment + workspaces modal`
- [x] 6.2 Update session summary in wiki source `2026-05-13-pi-worktrees-extension.md` to
       note the new dashboard-visual-feedback change
