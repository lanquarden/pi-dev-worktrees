## Tasks

### 1. `devcontainer.ts` — extend `buildStartArgs` and `startContainer`

- [x] 1.1 Add `noCache = false` as fourth parameter to `buildStartArgs`; append `"--no-cache"` to args when true
- [x] 1.2 Add `noCache = false` as third parameter to `startContainer`; pass through to `buildStartArgs`

### 2. `index.ts` — add `devcontainerRebuild` and dispatch

- [x] 2.1 Add `devcontainerRebuild(pi)` function — same flow as `devcontainerOn` but calls `startContainer(projectRoot, true, true)` and uses the rebuild notify message
- [x] 2.2 Add `arg === "rebuild"` branch in `/devcontainer` command handler
- [x] 2.3 Update `/devcontainer` command description to `"Manage devcontainer targeting. Usage: /devcontainer [on | off | rebuild | logs]"`
- [x] 2.4 Update fallthrough usage hint to `"Usage: /devcontainer [on | off | rebuild | logs]"`

### 3. Tests — `tests/devcontainer.test.ts`

- [x] 3.1 Test `buildStartArgs` with `noCache = true` — `"--no-cache"` present in output
- [x] 3.2 Test `buildStartArgs` with `noCache = false` (default) — `"--no-cache"` absent

### 4. Documentation

- [x] 4.1 Update `README.md` Features list: extend `/devcontainer [on | off]` entry to `/devcontainer [on | off | rebuild | logs]` and add a one-line description of `rebuild`
- [x] 4.2 Update `README.md` Devcontainer section: add a note that `/devcontainer rebuild` forces a full image rebuild with `--no-cache` (vs `/devcontainer on` which reuses the layer cache)

### 5. Verification

- [x] 4.1 Run `/devcontainer rebuild` — confirm notify message mentions "full image rebuild"
- [x] 4.2 Confirm `devcontainer up` was spawned with `--no-cache` in `/devcontainer logs`
- [x] 4.3 Run `/devcontainer` (no args) — confirm usage hint includes `rebuild`
- [x] 4.4 Run `npm test` — all tests pass

### 5. Commit

- [x] 5.1 Commit with message: `feat: add /devcontainer rebuild for no-cache image rebuild`
