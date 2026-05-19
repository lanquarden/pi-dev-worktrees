# Spec — `/worktree prune`

---

## Requirements

### R1 — `/workspace-cleanup` SHALL call `git worktree prune` after the removal loop

- SHALL execute `git worktree prune` in `projectRoot` once, after the candidate worktree removal loop completes.
- SHALL execute unconditionally — regardless of whether any worktrees were removed during the current invocation.
- SHALL NOT surface a failure of `git worktree prune` as a fatal error; a warning notification is sufficient if the command exits non-zero.

### R2 — `/worktree prune` command SHALL run `git worktree prune` and report results

- SHALL be a recognised subcommand of `/worktree`.
- SHALL execute `git worktree prune` in `projectRoot`.
- SHALL capture combined stdout and stderr from the command.
- If the captured output is non-empty (after trimming whitespace), SHALL display it to the user verbatim.
- If the captured output is empty, SHALL notify the user: "No stale worktree metadata found."
- On command failure (non-zero exit), SHALL notify the user with the error message.

### R3 — `/worktree prune` SHALL be dispatched before the branch-name fallthrough

- The dispatch check for `"prune"` SHALL appear in the `/worktree` handler before the code path that treats the argument as a branch name.
- The word `"prune"` is reserved and cannot be used as a branch name via the `/worktree` command.

---

## Scenarios

### Scenario 1 — `/workspace-cleanup` prunes after removing worktrees

**Given** a project with two stale worktrees eligible for removal and one stale `.git/worktrees/` metadata entry from a prior manual deletion  
**When** the user runs `/workspace-cleanup` and confirms removal  
**Then** both worktrees are removed via `wtp remove`  
**And** `git worktree prune` is called once after the loop  
**And** the stale metadata entry from the prior manual deletion is also cleaned up

### Scenario 2 — `/workspace-cleanup` prunes even when nothing was removed

**Given** a project with no worktrees eligible for removal but one stale `.git/worktrees/` entry from a prior manual deletion  
**When** the user runs `/workspace-cleanup`  
**Then** no `wtp remove` calls are made  
**And** `git worktree prune` is still called  
**And** the stale metadata entry is cleaned up

### Scenario 3 — `/worktree prune` reports pruned entries

**Given** a project with one stale `.git/worktrees/` entry (worktree directory was manually deleted)  
**When** the user runs `/worktree prune`  
**Then** `git worktree prune` is executed in `projectRoot`  
**And** the output (e.g. `Removing worktrees/feature-x: gitdir file points to non-existent location`) is displayed to the user

### Scenario 4 — `/worktree prune` reports nothing to prune

**Given** a project with no stale worktree metadata  
**When** the user runs `/worktree prune`  
**Then** `git worktree prune` is executed in `projectRoot`  
**And** the user is notified: "No stale worktree metadata found."

### Scenario 5 — `/worktree prune` is dispatched before branch-name fallthrough

**Given** the `/worktree` command handler  
**When** the argument is exactly `"prune"`  
**Then** the prune handler executes  
**And** the code does NOT attempt to look up a branch named `"prune"`
