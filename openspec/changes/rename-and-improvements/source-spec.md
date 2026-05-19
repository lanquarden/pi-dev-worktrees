# Exploration: `pi-worktrees` — learnings from peer plugins & rename proposal

**Date:** 2026-05-19  
**Status:** Exploration (pre-spec)  
**Scope:** Comparison of `zenobi-us/pi-worktrees`, `rielj/pi-git-worktrees`, and the local plugin; rename to `pi-dev-worktrees`.

---

## 1. What was studied

| Plugin | Focus |
|--------|-------|
| `zenobi-us/pi-worktrees` (`@zenobius/pi-worktrees`) | CLI-first worktree management with rich config, pattern-matching per repo, optional branch-name generator, post-create hooks (onCreate), and animated progress during hook execution |
| `rielj/pi-git-worktrees` | Parallel-agent orchestration via tmux, LLM tools (`wt_new`, `wt_send`, `wt_wait`, `wt_gather`), heartbeat monitoring, interactive `/worktrees` panel with keyboard nav |
| Local `pi-worktrees` (this repo) | Worktree-per-branch via `wtp`, devcontainer targeting with bash-intercept routing, dashboard visual feedback (`footer-segment`, `workspaces-modal`) |

---

## 2. Unique strengths of this plugin that peers lack

### 2.1 Devcontainer targeting (the exclusive differentiator)
Neither `zenobi-us` nor `rielj` implement devcontainer support of any kind. This plugin:
- Auto-generates `.pi/devcontainer.override.json` (full merge of `devcontainer.json` + workspace-mount overrides) so `--override-config` always points to a valid file.
- Spawns `devcontainer up` in the background, polls the startup log JSON line for `outcome: success/error`, and marks the container ready without blocking the TUI.
- Routes all bash tool calls through `devcontainer exec` transparently; `HOST:` prefix escapes back to the host.
- Stops the container (via Docker container ID) on `/devcontainer off` so the next start always uses the freshest config.
- Works in combination with worktrees: `devcontainer exec … -- sh -c 'cd <worktree> && <cmd>'`.

**This is the primary reason for renaming to `pi-dev-worktrees`** — the name signals that it handles both developer worktrees *and* developer containers; peers only do the former.

### 2.2 `wtp`-backed worktrees
Using `wtp` rather than raw `git worktree add` gives:
- `.wtp.yml` auto-generation with sensible defaults (base_dir, copy-secrets hook, direnv hook).
- `wtp remove` for safe cleanup in `/workspace-cleanup`.
- Enforces placement under `.pi/worktrees/` (gitignored) so worktrees never accidentally land in the project tree root.

### 2.3 Dashboard integration
`zenobi-us` and `rielj` have no pi-agent-dashboard integration. This plugin emits `pi-worktrees:state` and structured `ui:list-modules` modules (`footer-segment` + `management-modal`).

---

## 3. Gaps identified by studying the peers

### Gap A — No `onCreate` hooks (from `zenobi-us`)
`@zenobius/pi-worktrees` runs an `onCreate` command array after worktree creation, with live animated output in the TUI. This is valuable for:
- Running `mise install`, `npm install`, etc. in the new worktree automatically.
- The current plugin only generates `.wtp.yml` with two shell hooks (copy secrets, direnv allow) but those run inside `wtp` silently; there is no way for the LLM or user to see what happened.

**Proposal:** Add a post-create hook runner inside `createOrTargetWorktree` (or inside `worktrees.ts`) that runs a configurable command array and streams output back to `ctx.ui.notify`.

### Gap B — No per-repo config (from `zenobi-us`)
`@zenobius/pi-worktrees` stores settings in `~/.pi/agent/pi-worktrees.config.json` keyed by repo URL glob patterns (e.g. `"github.com/org/*"`). Each entry can have a different `worktreeRoot`, `onCreate`, and `branchNameGenerator`.

The current plugin is fully zero-config (everything hardcoded to `.pi/worktrees/`) which is fine for single-project use but becomes limiting when working across multiple repos from the same global pi install.

**Proposal:** Add optional `~/.pi/agent/pi-dev-worktrees.config.json` with at minimum `worktreeRoot` override and `onCreate` array. Keep zero-config as the default.

### Gap C — No branch-name generator (from `zenobi-us`)
`@zenobius/pi-worktrees` has a `branchNameGenerator` command (e.g. `pi -p "…" --model local/model`) that produces a slug from a freeform prompt. The LLM calls `/worktree create --generate "auth refactor"` and the extension runs the generator to produce a valid branch name.

**Proposal:** Low-priority. The current plugin users typically provide branch names directly. Could be added as an opt-in feature later.

### Gap D — No parallel agent orchestration (from `rielj`)
`rielj/pi-git-worktrees` builds a full fan-out orchestration model: spawn multiple Pi sessions in tmux, send messages to them, wait for idle (via heartbeat files), gather context. This is a fundamentally different use-case from what the local plugin does (single-session isolation + devcontainer routing).

**Proposal:** Out of scope for this plugin. `rielj`'s approach requires tmux and works best when `pi` itself is the orchestrator. Our plugin focuses on routing isolation, not multi-agent dispatch. These could coexist as separate extensions.

### Gap E — No `/worktree cd` / shell integration (from `zenobi-us`)
`@zenobius/pi-worktrees` prints the worktree path on `/worktree cd <name>` so the user can `cd` to it in a shell via command substitution. Minor UX convenience.

**Proposal:** Add `/worktree path [branch]` (or just include the path in `/workspaces` output, which we already do).

### Gap F — No `wtp prune` equivalent
`@zenobius/pi-worktrees` has `/worktree prune` to remove stale git worktree metadata (`git worktree prune`). Our `/workspace-cleanup` only removes directories, not stale metadata.

**Proposal:** Add `git worktree prune` call after successful `wtp remove` in `/workspace-cleanup`, and expose `/worktree prune` as a direct command.

### Gap G — `/devcontainer rebuild` missing
When the `Dockerfile` or `devcontainer.json` changes, users need to fully rebuild the container image (not just restart). Currently they must run `/devcontainer off` then `/devcontainer on` and the container is stopped and re-upped with `--remove-existing-container`. There is no explicit rebuild path.

**Proposal:** Add `/devcontainer rebuild` that regenerates the override, stops the container, and runs `devcontainer up --no-cache --remove-existing-container` in the background.

### Gap H — No multi-devcontainer (multiple `.devcontainer/` configurations)
Some projects have multiple devcontainer configurations (e.g. `.devcontainer/base/devcontainer.json`, `.devcontainer/gpu/devcontainer.json`). The current plugin only looks at `.devcontainer/devcontainer.json` or `.devcontainer.json`.

**Proposal:** Auto-detect multiple configurations and prompt the user to select on `/devcontainer on` if more than one is found.

---

## 4. Rename: `pi-worktrees` → `pi-dev-worktrees`

### Rationale
- Neither peer plugin includes devcontainer support; the devcontainer feature is the primary differentiator.
- "Dev worktrees" signals isolated development environments (worktree + optional container), not just git mechanics.
- The npm package name `pi-worktrees` would conflict with `@zenobius/pi-worktrees` if ever published; `pi-dev-worktrees` is unambiguous.

### Rename scope
| Location | Old | New |
|----------|-----|-----|
| `package.json` `.name` | `pi-worktrees` | `pi-dev-worktrees` |
| `README.md` title | `pi-worktrees` | `pi-dev-worktrees` |
| `dashboard-events.ts` event namespace | `pi-worktrees:*` | `pi-dev-worktrees:*` |
| `dashboard-ui.ts` `NAMESPACE` const | `pi-worktrees` | `pi-dev-worktrees` |
| `session.ts` custom entry type | `pi-worktrees:state` | `pi-dev-worktrees:state` |
| `index.ts` status bar key | `pi-worktrees` | `pi-dev-worktrees` |
| Extension directory (if project-local) | `.pi/extensions/pi-worktrees` | `.pi/extensions/pi-dev-worktrees` |

> **Note:** Event namespace change is breaking for any consumer reading `pi-worktrees:*` events (e.g. pi-agent-dashboard bridge). Both names should be emitted during a transition period, or the bridge updated in lockstep.

---

## 5. Priority ranking for improvements

| # | Gap | Effort | Value |
|---|-----|--------|-------|
| 1 | **Rename** to `pi-dev-worktrees` | Low | High (brand clarity) |
| 2 | **`/devcontainer rebuild`** (Gap G) | Low | High (common workflow) |
| 3 | **`/worktree prune`** + prune after cleanup (Gap F) | Low | Medium |
| 4 | **`onCreate` hooks** (Gap A) | Medium | High (automation) |
| 5 | **Multi-devcontainer config selection** (Gap H) | Medium | Medium |
| 6 | **Per-repo config** (Gap B) | Medium | Medium (multi-repo users) |
| 7 | **Branch-name generator** (Gap C) | Low | Low (nice to have) |
| 8 | **Parallel agent orchestration** (Gap D) | High | Out of scope |

---

## 6. Conclusion

The local `pi-worktrees` plugin has a unique, un-replicated devcontainer integration that justifies standing alone and warrants the rename to `pi-dev-worktrees`. The most actionable improvements from studying the peers are:

1. **Rename** (branding, avoids package name collision).
2. **`/devcontainer rebuild`** command — fills a common workflow gap with minimal code.
3. **`/worktree prune`** — trivial addition (`git worktree prune`), pairs well with existing `/workspace-cleanup`.
4. **`onCreate` post-create hooks** — brings the biggest workflow win, inspired by `@zenobius/pi-worktrees`.

The parallel-agent orchestration model from `rielj/pi-git-worktrees` is a different product class (tmux-based multi-session) and should be treated as a complementary extension rather than something to absorb.
