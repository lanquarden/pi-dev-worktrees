# Tasks: Per-Repo Config for worktreeRoot Override

---

## 1. src/config.ts — new file

- [ ] Define `RepoEntry` type: `{ repoGlob: string; worktreeRoot: string; postCreateHooks?: WtpHook[] }`
- [ ] Define `PluginConfig` type: `{ repos: RepoEntry[] }`
- [ ] Implement `loadPluginConfig(): PluginConfig | null` — reads `~/.pi/agent/pi-dev-worktrees.config.json`; returns null if absent; returns null + `console.warn` if present but invalid JSON
- [ ] Implement `matchRepoGlob(pattern: string, url: string): boolean` — single-pass `*` wildcard matcher (no external dependency)
- [ ] Implement `resolveWorktreeRoot(remoteUrl: string, config: PluginConfig | null): string` — iterates `config.repos` in order, returns first matching `worktreeRoot`, falls back to `".pi/worktrees"`
- [ ] Implement `resolvePostCreateHooks(remoteUrl: string, config: PluginConfig | null): WtpHook[]` — returns `postCreateHooks` of first matching entry, or `[]`

---

## 2. src/worktrees.ts — update call signatures

- [ ] Update `createOrTargetWorktree` to accept a `worktreeRoot: string` parameter; replace all internal references to the hardcoded `.pi/worktrees` path (resolve relative paths against `projectRoot`, use absolute paths as-is)
- [ ] Update `ensureWtpYml` to accept `worktreeRoot: string` and `postCreateHooks: WtpHook[]` parameters; inject `worktreeRoot` as `base_dir` at write time; append `postCreateHooks` after the two default hooks in the generated YAML

---

## 3. src/index.ts — wire up config resolution

- [ ] In `session_start`, after resolving `projectRoot`, attempt `git remote get-url origin`; store the result as `remoteUrl` (empty string on failure — no error surfaced)
- [ ] In `session_start`, call `loadPluginConfig()`, `resolveWorktreeRoot(remoteUrl, config)`, and `resolvePostCreateHooks(remoteUrl, config)`; store results as module-level `resolvedWorktreeRoot` and `resolvedPostCreateHooks`
- [ ] Thread `resolvedWorktreeRoot` and `resolvedPostCreateHooks` through to all call sites: `createOrTargetWorktree`, `ensureWtpYml`, and the `enumerateWorktreeDirs` call in `/workspace-cleanup`

---

## 4. tests/config.test.ts — unit tests

- [ ] Tests for `loadPluginConfig`: absent file returns null; valid JSON (including `postCreateHooks`) returns parsed config; invalid JSON returns null and calls `console.warn`
- [ ] Tests for `matchRepoGlob`: exact match, `*` wildcard (org-level, catch-all), no-match, case-sensitivity
- [ ] Tests for `resolveWorktreeRoot`: first-match-wins, falls back to default on no match, handles null config
- [ ] Tests for `resolvePostCreateHooks`: returns hooks from matching entry, returns `[]` when entry has no hooks, returns `[]` on no match, returns `[]` for null config

---

## 5. Documentation

- [ ] Update `README.md` Features list: update the `/worktree` bullet to mention that `base_dir` and post-create hooks can be configured via `~/.pi/agent/pi-dev-worktrees.config.json`
- [ ] Update `README.md` Worktrees section: add a **Per-repo config** subsection describing the `~/.pi/agent/pi-dev-worktrees.config.json` schema (`repoGlob`, `worktreeRoot`, `postCreateHooks`), glob syntax, and a short example

---

## 6. Verification

- [ ] Manual test: add a config entry matching the current repo's origin URL with a custom `worktreeRoot`; run a worktree creation command; confirm the worktree lands at the custom path
- [ ] Manual test: add a config entry with `postCreateHooks`; delete `.wtp.yml` and run `/worktree init`; confirm the hooks appear in the generated file
- [ ] Manual test: remove or rename the config file; confirm worktrees land at the default `.pi/worktrees` path (zero-config behaviour unchanged)
- [ ] Run `npm test` and confirm all tests pass with no regressions

---

## 7. Commit

- [ ] `feat: add per-repo config for worktreeRoot and postCreateHooks`
