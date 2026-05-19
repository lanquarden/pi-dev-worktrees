# Design: `/devcontainer rebuild`

## Context

`devcontainerOn` in `index.ts` already implements the full container lifecycle:
1. Check `devcontainer` CLI is present
2. Find the devcontainer config path
3. Call `generateOverrideJson` (force=true)
4. Call `stopContainer` + `clearStartupLog`
5. Call `startContainer(projectRoot, removeExisting=true)`
6. Set state + emit events + notify

`startContainer` delegates arg construction to `buildStartArgs(projectRoot, overridePath, removeExisting)`.
`buildStartArgs` is exported and already unit-tested.

The only difference between `/devcontainer on` and `/devcontainer rebuild` is step 5:
rebuild passes `noCache=true` → `--no-cache` in the `devcontainer up` args.

---

## Decisions

### D1 — Add `noCache` as an optional fourth parameter to `buildStartArgs`

```ts
export function buildStartArgs(
  projectRoot: string,
  overridePath: string,
  removeExisting: boolean,
  noCache = false,
): string[]
```

Append `"--no-cache"` when `noCache` is true. Position: after `--remove-existing-container`
(if present), before any future args.

**Alternative:** A new `buildRebuildArgs` function. Rejected — adds duplication with no
benefit; the boolean parameter is clear and the function is small.

### D2 — Add `noCache` as an optional third parameter to `startContainer`

```ts
export function startContainer(projectRoot: string, removeExisting = false, noCache = false): void
```

Passes `noCache` through to `buildStartArgs`. All existing callers (`devcontainerOn`)
continue to work without changes since `noCache` defaults to `false`.

### D3 — `devcontainerRebuild` is a new function in `index.ts`, not a flag on `devcontainerOn`

`devcontainerOn` and `devcontainerRebuild` share the same structure. Rather than adding
a parameter to `devcontainerOn`, a dedicated `devcontainerRebuild` function is added for
clarity. The two functions can share a private helper if the duplication becomes
uncomfortable, but at ~20 lines each the duplication is acceptable.

**Alternative:** `devcontainerOn(pi, { noCache: true })`. Rejected — the call sites are
different slash commands with different user-visible semantics; keeping them separate
makes the intent obvious at the call site.

### D4 — Notify message distinguishes rebuild from normal start

`/devcontainer on` notifies: `"Devcontainer start initiated — run /devcontainer logs to follow progress"`

`/devcontainer rebuild` notifies: `"Devcontainer rebuild started — full image rebuild in progress (this takes longer than a normal start)"`

This sets expectations: a rebuild can take minutes vs. seconds for a normal container start.

### D5 — No new tests for `devcontainerRebuild` in `index.ts`; only `buildStartArgs` unit tests

`devcontainerRebuild` is a thin coordinator (same shape as `devcontainerOn`). The
observable behaviour difference is `--no-cache` in the spawned command, which is covered
by the `buildStartArgs` unit test for `noCache=true`. Integration testing the full flow
would require mocking `spawn`, which is disproportionate for this change.

---

## Migration Plan

1. Update `buildStartArgs` in `devcontainer.ts` — add `noCache` parameter
2. Update `startContainer` in `devcontainer.ts` — add `noCache` parameter, pass through
3. Add `devcontainerRebuild(pi)` in `index.ts` — mirrors `devcontainerOn` with `noCache=true`
4. Extend `/devcontainer` dispatch in `index.ts` — add `arg === "rebuild"` branch
5. Update description string and fallthrough usage hint
6. Add unit tests for `buildStartArgs` with `noCache=true` in `tests/devcontainer.test.ts`

No breaking changes. No data migration. Rollback: revert `devcontainer.ts` and `index.ts`.
