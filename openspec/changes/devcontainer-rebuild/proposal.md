# Proposal: `/devcontainer rebuild`

**Status:** Proposal
**Date:** 2026-05-19
**Parent exploration:** `openspec/changes/rename-and-improvements/source-spec.md` (Gap G)

---

## Why

`/devcontainer on` stops the existing container, regenerates `.pi/devcontainer.override.json`,
and starts a fresh container with `--remove-existing-container`. This covers the common
case of re-targeting after a pi session restart. However, when the `Dockerfile` or base
image changes, Docker's layer cache means the new container is built from stale layers —
the image is not rebuilt.

Users currently have no in-plugin path to force a full image rebuild. The workaround is
`/devcontainer off` followed by a manual `devcontainer up --no-cache` in the terminal,
which is error-prone (users may forget `--no-cache` or the `--override-config` flag).

`/devcontainer rebuild` makes this a first-class one-command operation.

---

## Problem statement

`devcontainer up` reuses Docker layer cache by default. After a `Dockerfile` or base-image
change, `/devcontainer on` produces a container built from stale layers. There is no
in-plugin command to force a clean image build.

---

## Proposed solution

Add `rebuild` as a new subcommand of `/devcontainer`. It behaves identically to
`/devcontainer on` except:

1. It passes `--no-cache` to `devcontainer up`, forcing Docker to rebuild all image layers
   from scratch.
2. It notifies the user that a full image rebuild is in progress (rebuilds take longer than
   a normal start).

### Implementation

- Add a `noCache` parameter to `buildStartArgs` in `devcontainer.ts`.
- Add a `devcontainerRebuild(pi)` function in `index.ts` that calls the existing
  `generateOverrideJson` + `stopContainer` + `clearStartupLog` + `startContainer` sequence,
  passing `noCache: true`.
- Extend the `/devcontainer` command dispatch in `index.ts` with an `arg === "rebuild"` branch.
- Update the `/devcontainer` command description and usage hint string.

### No new exports needed

`buildStartArgs` is already exported. Adding `noCache` as an optional third boolean
parameter (`noCache = false`) is backwards-compatible with all existing callers.

---

## Alternatives considered

**`/devcontainer on --no-cache` flag** — POSIX-style flags are unusual in the pi slash-command
UX (established by the `wtp-hook-management` decision D4). A dedicated subcommand is cleaner.

**Reuse `/devcontainer on` with a confirmation prompt** — Would add friction to the common
non-rebuild case. Rebuild is an explicit intent, so a separate command is the right model.

**Expose `noCache` via `/worktree init`** — Unrelated concern; init is for hook configuration,
not container lifecycle.
