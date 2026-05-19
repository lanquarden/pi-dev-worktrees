# Tasks — `/worktree prune`

---

## 1. `src/index.ts` — add prune call to `/workspace-cleanup`

- [ ] After the candidate removal loop in the `/workspace-cleanup` handler (around line 828), add an unconditional `execSync("git worktree prune", { cwd: projectRoot, encoding: "utf8" })` call wrapped in a try/catch that emits a warning notification on failure.

---

## 2. `src/index.ts` — add `/worktree prune` dispatch and handler

- [ ] Insert a dispatch check for `arg === "prune"` in the `/worktree` command handler, before the branch-name fallthrough (after the existing `"hooks clear"` check).
- [ ] Implement the handler: run `execSync("git worktree prune", { cwd: projectRoot, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] })`, capture combined stdout+stderr, and notify the user with the output if non-empty or with "No stale worktree metadata found." if empty. Wrap in try/catch and notify on error.

---

## 3. Documentation

- [ ] Update `README.md` Features list: add `/worktree prune` as a bullet under `/worktree`
- [ ] Update `README.md` Worktrees section: note that `/workspace-cleanup` runs `git worktree prune` after removals, and that `/worktree prune` can be run standalone to clear stale `.git/worktrees/` metadata

---

## 4. Verification

- [ ] Run `/workspace-cleanup` in a repo with a manually-deleted worktree directory; confirm `git worktree list` shows no ghost entries afterwards.
- [ ] Run `/worktree prune` in a repo with and without stale metadata; confirm correct output in both cases.
- [ ] Run `npm test` and confirm all existing tests pass with no regressions.

---

## 4. Commit

```
feat: run git worktree prune in /workspace-cleanup and add /worktree prune command
```
