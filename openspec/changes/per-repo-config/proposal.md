# Proposal: Per-Repo Config for worktreeRoot Override

**Status:** Proposal
**Date:** 2026-05-19
**Parent:** rename-and-improvements/source-spec.md (Gap B)

---

## Why

The plugin is currently zero-config, which works well for a single-project setup. In a multi-repo global pi install, however, different repositories may need different worktree locations. For example:

- A large monorepo may benefit from worktrees on a fast local SSD rather than a network drive.
- A developer may want all worktrees for a particular GitHub org to land in a shared location outside the repo tree.

Without per-repo config, the only options are to edit the plugin source or to accept the hardcoded default for every repo.

## Problem

`worktreeRoot` is hardcoded to `.pi/worktrees` in `worktrees.ts`. The `WTP_YML_CONTENT` template embeds `base_dir: ".pi/worktrees"` and `createOrTargetWorktree` always resolves paths under `join(projectRoot, ".pi", "worktrees", branch)`. There is no mechanism to override this per repo without modifying source.

## Solution

Introduce an optional global config file at `~/.pi/agent/pi-dev-worktrees.config.json`. It contains an array of `{ repoGlob, worktreeRoot }` entries matched against the repo's git remote `origin` URL. The first match wins. If no entry matches, the hardcoded default `.pi/worktrees` is used unchanged — zero-config behaviour is fully preserved.

## Scope

This change covers `worktreeRoot` and `postCreateHooks` per repo entry. `worktreeRoot` controls where worktrees land; `postCreateHooks` controls what gets appended to the default hooks in the auto-generated `.wtp.yml`. Both are machine/org-level concerns that belong in the global config rather than per-project `.wtp.yml`.

## Alternatives Considered

**Per-project `.pi/pi-dev-worktrees.json`**
Rejected. Requires checking the file into each repo or maintaining `.gitignore` entries across all repos. The path override is a machine-specific concern (e.g. SSD mount points) and does not belong in the project tree.

**Environment variable `PI_DEV_WORKTREES_ROOT`**
Rejected. A single environment variable cannot differentiate between repos. It would impose a single override for every repo on the machine, which is less flexible than glob-based matching.

**TOML or YAML format**
Rejected. JSON is parseable with the built-in `JSON.parse` — no additional dependency. TOML and YAML both require extra packages and add complexity for a config file that is expected to be small and rarely edited.
