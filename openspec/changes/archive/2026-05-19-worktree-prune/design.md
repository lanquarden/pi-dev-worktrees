# Design — `/worktree prune`

---

## D1 — Use `execSync` for `git worktree prune`

`git worktree prune` is synchronous and fast. It produces no meaningful stdout on success (exit 0) and no interactive prompts. `execSync` is already used in the codebase for analogous one-shot git queries (e.g. `git status --porcelain` in the `/workspace-cleanup` handler). Using `execSync` keeps the call site a one-liner and avoids the overhead of setting up a `spawnSync` argument array for a command with no variable arguments.

For the `/worktree prune` handler, stdout+stderr are captured via the `{ encoding: "utf8" }` option so that any pruned-entry lines can be surfaced to the user.

---

## D2 — Prune runs unconditionally at the end of `/workspace-cleanup`

The prune call is placed after the candidate loop and executes regardless of whether `removedCount > 0`. Rationale: stale `.git/worktrees/` entries may exist from manual deletions performed before this session. A conditional on `removedCount` would silently skip cleanup in that scenario. A no-op `git worktree prune` completes in approximately 5 ms; the cost of unconditional execution is negligible.

---

## D3 — `"prune"` is dispatched before the branch-name fallthrough

The `/worktree` command handler dispatches on string-equality checks in order: `"init"`, `"hooks"`, `"hooks show"`, `"hooks add <…>"`, `"hooks remove <…>"`, `"hooks clear"`, then falls through to treat the argument as a branch name. `"prune"` is inserted into this chain before the fallthrough, following the same pattern as the other subcommands.

Trade-off: a branch literally named `"prune"` cannot be targeted via `/worktree prune`. This is the same trade-off accepted for every other reserved subcommand word (see D7 in the wtp-hook-management design). The word `"prune"` is unlikely to be used as a branch name and is documented as reserved.

---

## D4 — No new helper function

Both call sites (`/workspace-cleanup` and `/worktree prune`) use the same one-liner:

```typescript
execSync("git worktree prune", { cwd: projectRoot, encoding: "utf8" });
```

Extracting a helper function (`runGitWorktreePrune`) adds a layer of indirection for two identical one-liners. If a third call site appears, extract then (YAGNI).

---

## D5 — Report pruned entries; notify on no-op

`git worktree prune` prints one line per pruned entry to stderr (format: `Removing worktrees/<name>: <reason>`), and nothing to stdout on a clean run. The handler captures both streams. If the combined output is non-empty after trimming, it is displayed verbatim. If empty, the user is notified with "No stale worktree metadata found." This gives useful feedback in both cases without requiring the handler to parse git output.
