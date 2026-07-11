# Tasks: External Worktree Mode, Local Artifact Excludes, and Plain-pi Routing Feedback

> Draft only. Task checkboxes intentionally remain open until the design is approved.

---

## 1. Configuration

- [x] 1.1 Extend `PluginConfig` with independent optional `worktrees.enabled` and `devcontainer.enabled` flags plus optional `repos`.
- [x] 1.2 Add pure capability resolvers whose defaults are enabled and whose only disabling value is explicit `false`.
- [x] 1.3 Make existing repo resolvers tolerate an omitted `repos` array.
- [x] 1.4 Add config tests for both defaults, explicit true/false, all four capability combinations, minimal external config, and existing config compatibility.

## 2. Runtime roots and state sanitization

- [x] 2.1 Capture `sessionCwd = ctx.cwd` on each `session_start`.
- [x] 2.2 Resolve `gitRoot` with `cwd: sessionCwd` and derive `devcontainerRoot` from the ownership mode.
- [x] 2.3 Clear stale worktree state in external mode before any routing or UI update.
- [x] 2.4 Reconcile restored enabled devcontainer targeting at `devcontainerRoot`: leave differently rooted old containers alone, but stop/recreate a current-root container whose mount does not align.
- [x] 2.5 Persist starting state and automatically probe/start at the session cwd; disable with the normal diagnostic only when config/restart cannot proceed.
- [x] 2.6 Add startup/resume/reload tests for aligned state, different workspace roots, mismatched mounts, and missing config.

## 3. Worktree capability gating

- [x] 3.1 Skip remote/config matching, `.wtp.yml`, hooks, and `wtp` initialization in external mode.
- [x] 3.2 Skip worktree bash cwd routing and relative file-tool path routing.
- [x] 3.3 Omit worktree details from `before_agent_start` context.
- [x] 3.4 Remove the `worktree` tool from active LLM tools in external mode.
- [x] 3.5 Make every worktree tool and slash-command action return a non-mutating externally-managed response.
- [x] 3.6 Omit dashboard worktree management contributions and rows while preserving devcontainer feedback.
- [x] 3.7 Add negative tests proving no worktree command, tool, routing hook, or dashboard action mutates state/Git in external mode.

## 4. Devcontainer capability and cwd anchoring

- [x] 4.1 Gate restored state, initialization, context, routing, tool exposure, commands, and lifecycle operations behind `devcontainer.enabled`.
- [x] 4.2 Remove the `devcontainer` tool from active LLM tools when disabled while preserving unrelated tools.
- [x] 4.3 Replace enabled devcontainer uses of the coupled project root with `devcontainerRoot`.
- [x] 4.4 Ensure config discovery, override, log, probe, labels, start, exec, stop, rebuild, and logs all use the same root.
- [x] 4.5 Permit devcontainer operations in external-worktree mode without a Git repository.
- [x] 4.6 Add tests using distinct session cwd and Git root paths plus disabled-capability negative tests.
- [x] 4.7 Add an integration test asserting exact `--workspace-folder <sessionCwd>` argv.

## 5. Clone-local generated artifact excludes

- [x] 5.1 Add a helper that resolves the exclude file with `git rev-parse --git-path info/exclude` from the relevant Git root.
- [x] 5.2 Normalize generated paths to anchored, slash-separated, Git-root-relative patterns and append them idempotently.
- [x] 5.3 Route every extension code path that generates an in-repository file or directory through the helper, including `.wtp.yml`, devcontainer override/log files, and managed worktree roots.
- [x] 5.4 Document/test the invariant so future generated artifacts use the helper rather than a fixed startup list.
- [x] 5.5 Remove all automatic `.gitignore` mutation while preserving existing user entries.
- [x] 5.6 Make exclusion best-effort for external-mode non-Git directories.
- [x] 5.7 Add tests for normal repositories, linked-worktree Git paths, nested session cwd, duplicate calls, out-of-repo roots, pre-existing tracked/generated files, and a representative future artifact.

## 6. Plain-pi status and native dispatch rendering

- [x] 6.1 Make status values contain only active container state and clear the slot when inactive.
- [x] 6.2 Register a TUI-only bash wrapper derived from `createBashToolDefinition(sessionCwd)` that preserves built-in execution and result rendering.
- [x] 6.3 Add a themed, width-aware custom `renderCall` with the original LLM command left-justified and DEV/HOST/error, RTK/fallback, and managed-worktree CWD chips right-justified.
- [x] 6.4 Coordinate renderer invalidation and dispatch metadata by `toolCallId`.
- [x] 6.5 Distinguish RTK applied from RTK fallback.
- [x] 6.6 Remove the existing executable `# [container]` display comment once native rendering is active.
- [x] 6.7 Show CWD only for extension-managed worktree routing and omit it in external/Herdr mode.
- [x] 6.8 Detect another non-built-in bash owner, warn once, and retain that definition while preserving event-based routing.
- [x] 6.9 Keep ordinary host-only calls visually identical to stock bash calls.
- [x] 6.10 Add renderer and mode-behavior tests for left/right alignment, narrow-width wrapping, DEV, HOST, error, RTK, fallback, managed CWD, external CWD omission, pending-to-routed redraw, and no-op host calls.

## 7. Parallel-safe routing metadata

- [x] 7.1 Replace `lastBashRouting` with metadata keyed by `toolCallId`.
- [x] 7.2 Consume and delete only the matching entry in `tool_result`.
- [x] 7.3 Preserve existing LLM-visible `[container]` / `[host]` grounding rules.
- [x] 7.4 Add an out-of-order parallel bash-result test proving metadata does not cross calls.

## 8. Documentation

- [x] 8.1 Document the independent worktree/devcontainer capability flags and minimal Herdr config in root and package READMEs.
- [x] 8.2 Explain that devcontainer paths are rooted at the pi session cwd in external mode.
- [x] 8.3 Document that generated artifacts use `.git/info/exclude` and no longer update `.gitignore`.
- [x] 8.4 Document status and dispatch badges, including RTK fallback.
- [x] 8.5 Document that config changes require `/reload` or a new session runtime.

## 9. Verification

- [x] 9.1 Run all workspace tests.
- [ ] 9.2 Launch pi from a Herdr-managed worktree with external mode enabled and confirm no `.wtp.yml` or nested worktree is created.
- [ ] 9.3 Start/reuse a devcontainer and verify its Docker label, override, logs, and workspace all refer to the launch cwd.
- [ ] 9.4 Resume with mismatched restored workspace/mount state and confirm targeting automatically restarts at the session cwd.
- [x] 9.5 Confirm all generated local artifacts do not appear in `git status` and `.gitignore` remains byte-for-byte unchanged.
- [x] 9.6 Confirm native DEV/HOST/RTK/fallback chips are right-justified beside left-justified commands without changing dashboard rendering or executable command text.
- [x] 9.7 Confirm external mode never shows worktree status or CWD chips.
- [x] 9.8 Confirm RPC, JSON, and print modes receive no TUI-only renderer override.
