# Proposal: External Worktree Mode, Local Artifact Excludes, and Plain-pi Routing Feedback

**Status:** Draft for feedback
**Date:** 2026-07-11

---

## Why

`pi-dev-worktrees` currently assumes that it owns both workspace isolation and optional devcontainer routing. Herdr now provides the worktree lifecycle and starts pi in the selected workspace, so allowing this extension to create, switch, remove, or route into a second worktree is redundant and potentially unsafe.

The dashboard also supplied per-command `RTK`, `DEV`, `HOST`, and `CWD` chips. In plain pi, the persistent status line reports only the active branch and container state. The tool result has a coarse `[container]` or `[host]` prefix, but the terminal does not expose RTK rewriting, container identity, fallback, or the effective command cwd as clearly as the dashboard did.

## Problem

1. There is no supported way to keep devcontainer routing while disabling all extension-owned worktree behavior.
2. Devcontainer operations use the Git top-level resolved by the extension. In Herdr-managed sessions the authoritative workspace is the cwd in which pi started.
3. Restored extension state may contain a stale extension-owned worktree or a devcontainer workspace from a different cwd.
4. Plain-pi users lack compact, per-command routing feedback.
5. Bash result routing is tracked in one module-level variable, which can associate the wrong route with concurrently executing bash calls.
6. Generated local artifacts currently either appear as untracked files or cause the extension to edit the repository's shared `.gitignore`, even though they are machine/session-specific.

## Solution

### 1. Add an external-worktree mode

Extend `~/.pi/agent/pi-dev-worktrees.config.json` with an optional top-level setting:

```json
{
  "worktrees": {
    "enabled": false
  },
  "devcontainer": {
    "enabled": true
  }
}
```

When `worktrees.enabled` is `false`:

- the extension does not generate or read `.wtp.yml`;
- it does not route bash or file tools into an extension-owned worktree;
- its worktree tool is removed from the active LLM tool set;
- `/worktree` remains discoverable but reports that worktrees are externally managed;
- dashboard worktree management UI is not contributed;
- stale persisted worktree state is cleared; and
- devcontainer behavior remains available independently of Git worktree behavior.

The setting defaults to `true`, preserving current behavior.

Add an independent `devcontainer.enabled` capability flag. It also defaults to `true` for compatibility. Explicitly setting it to `false` disables devcontainer startup, routing, commands, tool exposure, restored state, and UI feedback. This makes all four worktree/devcontainer capability combinations intentional rather than deriving one from the other.

### 2. Anchor devcontainers to the session cwd

Capture `ctx.cwd` on every `session_start`. In external-worktree mode, use that exact path as the devcontainer workspace and as the root for config discovery, generated override/log files, probing, labels, start, exec, stop, rebuild, and logs.

This permits Herdr to select the worktree before launching pi, after which this extension only adds devcontainer routing inside that selected workspace.

### 3. Keep generated artifacts local with Git's per-clone exclude

Resolve the local exclude file with `git rev-parse --git-path info/exclude` and idempotently exclude every file or directory this extension generates inside the Git worktree/repository. The current artifact set includes `.wtp.yml`, `.pi/devcontainer.override.json`, `.pi/devcontainer-up.log`, and extension-created in-repository worktree roots; the implementation contract is deliberately generic so future generated artifacts use the same helper.

Paths are computed relative to the relevant Git worktree root, so a devcontainer rooted at a nested session cwd receives the correct exclude pattern. Artifacts outside the repository need no pattern. The extension never edits `.gitignore`; existing `.gitignore` lines are left untouched.

### 4. Improve plain-pi feedback with native custom rendering

Use two complementary signals:

- **Persistent status:** show only actionable container state, for example `container:on` or `container:starting`. Omit the package name and never report that worktrees are disabled/external. Clear the status when no container is active.
- **Per-command custom bash rendering:** wrap pi's built-in bash tool definition with a custom `renderCall` while preserving its built-in execution and result renderer. Keep the original LLM command left-justified and render themed `DEV`, `HOST`, `RTK`, `fallback`, managed-worktree `CWD`, and `error` chips right-justified within the available tool-row width. Presentation metadata never enters the executable command.

  Conceptual displays:

  ```text
  npm test                         DEV a1b2c3d4e5f6  RTK
  git status                                      HOST
  grep foo src             DEV a1b2c3d4e5f6  RTK fallback
  npm test                                       error
  ```

  `CWD` is shown only when this extension routes into one of its managed worktrees. It is omitted in external/Herdr mode because the session cwd is already authoritative.

The renderer reads per-call dispatch metadata keyed by `toolCallId` and requests a row redraw once routing is known. Keep the existing LLM-visible result grounding (`[container]` / `[host]`) and use the same per-call metadata so parallel calls remain correct.

## What Changes

- Extend global config with independent `worktrees.enabled` and `devcontainer.enabled` flags, and allow `repos` to be omitted.
- Separate the concepts of session cwd, Git root, and devcontainer workspace root.
- Gate all worktree initialization, commands, tool routing, context, and dashboard contributions.
- Sanitize restored state and automatically initialize/restart targeting at the session cwd when restored container mount state does not match it.
- Route every in-repository artifact generation through an idempotent clone-local exclude helper and remove `.gitignore` mutation.
- Add native custom bash-call rendering and per-call dispatch tracking while preserving built-in bash execution/result behavior.
- Update tests and README configuration/UX documentation.

## Scope

Included:

- Global on/off control for this extension's worktree capability.
- Devcontainer-only operation rooted at the pi session cwd.
- Plain-pi status and per-bash-call feedback.
- Parallel-safe routing metadata.
- Clone-local exclusion of extension-generated files and in-repository worktree directories.

Not included:

- Herdr integration or Herdr lifecycle management.
- Automatic discovery of a Herdr workspace through Herdr APIs.
- Renaming or splitting the npm package.
- A custom pi footer, persistent widget, or overlay.
- Reimplementing bash execution or result rendering; only the call/header renderer is customized.
- Per-repository worktree enablement overrides.

## Alternatives Considered

### Keep `/worktree off` as the migration path

Rejected. It is session state rather than durable configuration, leaves worktree tools and initialization active, and does not make the session cwd authoritative for devcontainers.

### Infer Herdr from environment variables or Git worktree metadata

Rejected. The extension should not depend on Herdr internals. Explicit config is predictable and also supports other external worktree managers.

### Disable the entire extension

Rejected. Devcontainer routing remains useful and is the reason to keep the extension loaded.

### Replace pi's complete footer

Rejected. `ctx.ui.setFooter()` replaces the built-in footer and can conflict with other extensions. `ctx.ui.setStatus()` composes with the existing footer.

### Add a persistent widget above or below the editor

Rejected for the default experience. A widget consumes a full row continuously for transient per-command information. It may be revisited as an opt-in diagnostics mode.

### Inject a shell-comment header into the executable command

Rejected after review. It is simple and works with the stock renderer, but presentation metadata should not alter the command payload. Pi exposes custom `renderCall` support, allowing native themed feedback that remains outside shell semantics and LLM-visible output.

### Customize bash rendering through a registered wrapper

Selected with constraints. Pi does not expose a standalone renderer decorator, so the extension must register a `bash` definition based on `createBashToolDefinition(sessionCwd)`. The wrapper preserves the built-in `execute` and `renderResult`, replacing only `renderCall`. RTK currently uses `tool_call` interception rather than registering another bash tool, so the design composes with its rewrite ordering. If another extension already owns `bash`, emit one warning and preserve routing without installing the custom renderer rather than silently replacing it.

### Put rich routing metadata into every tool result

Rejected as terminal UX. It adds repeated text to LLM context and command output. The result prefix remains intentionally minimal; rich metadata belongs in the TUI call header.

### Continue appending generated paths to `.gitignore`

Rejected. These files are local implementation artifacts and should not create repository diffs or impose ignore policy on collaborators. `.git/info/exclude` is clone-local and applies without changing tracked files.

### Hardcode `.git/info/exclude`

Rejected. Linked worktrees and repositories with an external Git directory do not necessarily have a `.git` directory at the workspace path. Git must resolve the correct exclude file via `git rev-parse --git-path info/exclude`.

## Remaining Review Questions

1. Is `worktrees.enabled` the preferred schema, or would a mode such as `worktrees.mode: "managed" | "external"` better communicate ownership?
2. Should native dispatch chips be default-on in TUI mode, or guarded by a separate UI config option?
