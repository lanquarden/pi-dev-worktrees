## Tasks

### 1. `worktrees.ts` — YAML helpers & return type change

- [x] 1.1 Add TypeScript types `WtpConfig`, `WtpHook`, `CreateWorktreeResult` in `worktrees.ts`
- [x] 1.2 Implement `readWtpYml(projectRoot)` — uses `js-yaml` `load()`, returns `WtpConfig | null`
- [x] 1.3 Implement `writeWtpYml(projectRoot, config)` — uses `js-yaml` `dump()` with `{ lineWidth: -1, noRefs: true }`
- [x] 1.4 Implement `listHooks(config)` — returns `config.hooks?.post_create ?? []`
- [x] 1.5 Implement `addCommandHook(config, command)` — appends `{ type: "command", command }` to `post_create`, returns new config
- [x] 1.6 Implement `removeHook(config, index)` — removes at 1-based index, throws `RangeError` if out of bounds
- [x] 1.7 Implement `formatHook(hook)` — formats one hook as display string (e.g. `"command:  npm install"`, `"copy:     .env → .env"`)
- [x] 1.8 Change `createOrTargetWorktree` return type to `CreateWorktreeResult`
- [x] 1.9 Replace `execSync("wtp add …")` with `spawnSync("wtp", [...], { encoding: "utf8" })` capturing stdout+stderr; set `hookOutput = (stdout + stderr).trim()`; throw on non-zero exit with the captured output in the message
- [x] 1.10 Return `{ path: worktreePath, hookOutput }` from `createOrTargetWorktree` (existing-worktree path returns `hookOutput: ""`)
- [x] 1.11 Export all new helpers

### 2. `index.ts` — wire hook output & new command handlers

- [x] 2.1 Update `worktreeSet` to destructure `{ path, hookOutput }` from `createOrTargetWorktree`; update `state.worktree.path` and `ActionResult.message` accordingly
- [x] 2.2 In the `/worktree` command handler, after `worktreeSet` succeeds, call a second `ctx.ui.notify(hookOutput, "info")` when `hookOutput` is non-empty
- [x] 2.3 Add `worktreeHooksShow(projectRoot)` function — reads `.wtp.yml`, formats hook list, returns `ActionResult`
- [x] 2.4 Add `worktreeHooksAdd(command, projectRoot)` function — reads/creates config, calls `addCommandHook`, writes back, returns `ActionResult`
- [x] 2.5 Add `worktreeHooksRemove(index, projectRoot, ctx)` async function — reads config, validates index, calls `ctx.ui.confirm`, calls `removeHook`, writes back
- [x] 2.6 Add `worktreeHooksClear(projectRoot, ctx)` async function — reads config, checks for hooks, calls `ctx.ui.confirm`, clears array, writes back
- [x] 2.7 Add `worktreeInit(projectRoot, ctx)` async function — confirm overwrite if file exists, `ctx.ui.input` for commands, `ctx.ui.input` for copy files, builds config, calls `writeWtpYml`
- [x] 2.8 Extend `/worktree` command dispatch: add checks for `"init"`, `"hooks"`, `"hooks show"`, `"hooks add "`, `"hooks remove "`, `"hooks clear"` before the branch-name fallthrough

### 3. Tests — `tests/worktrees.test.ts`

- [x] 3.1 Test `readWtpYml` — returns null when file absent; parses valid YAML correctly
- [x] 3.2 Test `listHooks` — returns empty array for empty/absent hooks; returns array for present hooks
- [x] 3.3 Test `addCommandHook` — appends correctly to empty and existing arrays; does not mutate input
- [x] 3.4 Test `removeHook` — removes correct index; throws `RangeError` for out-of-bounds
- [x] 3.5 Test `formatHook` — correct output for `command`, `copy`, `symlink`, and unknown types
- [x] 3.6 Test `writeWtpYml` / `readWtpYml` round-trip — write then read produces identical structure

### 4. Verification

- [ ] 4.1 Create a new worktree with `/worktree feature/test-hooks` — confirm hook output appears in a second TUI notification
- [ ] 4.2 Run `/worktree hooks` — confirm numbered list shows current `.wtp.yml` hooks
- [ ] 4.3 Run `/worktree hooks add mise install` — confirm hook is appended; run `/worktree hooks` to verify
- [ ] 4.4 Run `/worktree hooks remove 1` — confirm confirmation prompt; confirm hook is removed on accept, unchanged on cancel
- [ ] 4.5 Run `/worktree hooks clear` — confirm confirmation prompt; confirm all hooks cleared
- [ ] 4.6 Run `/worktree init` — confirm wizard prompts, confirm `.wtp.yml` is written correctly for both blank and filled inputs
- [x] 4.7 Run `npm test` — all tests pass

### 5. Commit

- [x] 5.1 Commit with message: `feat: surface wtp hook output and add /worktree hooks management`
