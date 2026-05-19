# Proposal — `/worktree prune`

**Status:** Proposal
**Date:** 2026-05-19
**Parent:** rename-and-improvements/source-spec.md (Gap F)

---

## Why

Git tracks worktree metadata in `.git/worktrees/<name>/`. When a worktree directory is removed by means other than `git worktree remove` (e.g. manual `rm -rf`, OS-level deletion, or the plugin's own `wtp remove` which delegates to the underlying CLI but does not call `git worktree prune`), the metadata directory is left behind. Running `git worktree list` will show a ghost entry with `(bare)` or a stale path until `git worktree prune` is called. This is a silent state corruption that can confuse tooling and users.

`git worktree prune` removes stale metadata entries. It is fast (~5 ms), idempotent, and safe to run at any time.

---

## Problem

1. `/workspace-cleanup` calls `wtp remove` for each candidate worktree but never calls `git worktree prune` afterwards. Stale `.git/worktrees/` entries accumulate.
2. There is no standalone command to prune stale worktree metadata. Users must drop to the shell and run `git worktree prune` manually.

---

## Solution

### Part 1 — `/workspace-cleanup` post-loop prune

After the candidate removal loop in the `/workspace-cleanup` handler, unconditionally call `git worktree prune` once. It runs regardless of whether any worktrees were actually removed in this session, because stale metadata may exist from earlier manual removals unrelated to the current invocation.

### Part 2 — `/worktree prune` command

Add `"prune"` as a recognised subcommand in the `/worktree` command dispatch. When matched, run `git worktree prune` in `projectRoot`, capture its stdout+stderr, and report the output to the user. If the output is empty (no-op), notify "No stale worktree metadata found."

---

## Alternatives Considered

### Run prune only when `removedCount > 0`

Rejected. Stale metadata may exist from manual removals that happened before this `/workspace-cleanup` invocation. Gating on `removedCount` would miss those cases. A no-op prune is cheap enough that the conditional buys nothing.

### Add an `--expire` flag to `/worktree prune`

Rejected. Git's default expiry (3 months for non-checked-out worktrees, 1 day for inaccessible ones) is appropriate for all anticipated use cases. Exposing `--expire` adds command-surface complexity with no concrete benefit for the current user base.
