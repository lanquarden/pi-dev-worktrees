## ADDED Requirements

### Requirement: `/workspace-cleanup` SHALL call `git worktree prune` after the removal loop
`/workspace-cleanup` SHALL execute `git worktree prune` in `projectRoot` once, after
the candidate worktree removal loop completes, unconditionally — regardless of whether
any worktrees were removed. A failure of `git worktree prune` SHALL NOT be fatal; a
warning notification is sufficient if the command exits non-zero.

#### Scenario: prunes after removing worktrees
- **GIVEN** a project with stale worktrees removed and one stale `.git/worktrees/` metadata entry from a prior manual deletion
- **WHEN** the user runs `/workspace-cleanup` and confirms removal
- **THEN** `git worktree prune` is called once after the removal loop
- **THEN** the stale metadata entry is cleaned up

#### Scenario: prunes even when nothing was removed
- **GIVEN** a project with no worktrees eligible for removal but one stale `.git/worktrees/` entry
- **WHEN** the user runs `/workspace-cleanup`
- **THEN** no `wtp remove` calls are made
- **THEN** `git worktree prune` is still called and the stale entry is cleaned up

---

### Requirement: `/worktree prune` command SHALL run `git worktree prune` and report results
`/worktree prune` SHALL be a recognised subcommand of `/worktree`. It SHALL execute
`git worktree prune` in `projectRoot`, capture combined stdout and stderr, and notify
the user with the output if non-empty (trimmed) or with `"No stale worktree metadata found."`
if empty. On non-zero exit it SHALL notify the user with the error message.

#### Scenario: reports pruned entries
- **GIVEN** a project with one stale `.git/worktrees/` entry
- **WHEN** the user runs `/worktree prune`
- **THEN** `git worktree prune` is executed in `projectRoot`
- **THEN** the command output is displayed to the user verbatim

#### Scenario: reports nothing to prune
- **GIVEN** a project with no stale worktree metadata
- **WHEN** the user runs `/worktree prune`
- **THEN** the user is notified: `"No stale worktree metadata found."`

---

### Requirement: `/worktree prune` SHALL be dispatched before the branch-name fallthrough
The dispatch check for `"prune"` SHALL appear in the `/worktree` handler before the
code path that treats the argument as a branch name. The word `"prune"` is reserved
and cannot be used as a branch name via the `/worktree` command.

#### Scenario: prune dispatched before branch-name fallthrough
- **GIVEN** the `/worktree` command handler
- **WHEN** the argument is exactly `"prune"`
- **THEN** the prune handler executes
- **THEN** the code does NOT attempt to look up a branch named `"prune"`
