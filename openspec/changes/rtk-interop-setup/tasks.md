## Tasks

### 1. Documentation — `settings.json` load order setup

- [x] 1.1 Add a **Companion extensions** section to `README.md` documenting `pi-rtk-optimizer` as the recommended companion, explaining why `pi install` is wrong (rank 4), and providing the `settings.json` `extensions` array snippet
- [x] 1.2 Add a **Incompatible extensions** note documenting `@sherif-fanous/pi-rtk` (`spawnHook` fires after routing) and `mcowger/pi-rtk` (stale, superseded)

---

### 2. Conflict detection at `session_start`

- [x] 2.1 In `session_start` handler in `index.ts`, add a `detectRtkConflicts(pi, ctx)` call after project root resolution
- [x] 2.2 Implement `detectRtkConflicts(pi, ctx)` in a new helper file `src/rtk-compat.ts`:
  - Call `pi.getAllTools()` to find the registered `bash` tool
  - If `bash` tool `sourceInfo.path` contains `"pi-rtk"` but not `"pi-rtk-optimizer"` and not `"pi-dev-worktrees"` → emit `warning` naming the extension and recommending `pi-rtk-optimizer`
  - Else if `bash` tool is overridden by any other non-built-in extension → emit generic `warning`
  - Call `pi.getCommands()` to check for a command named `"rtk"`; if found and bash tool is not incompatibly overridden → emit `info` advisory with `settings.json` snippet
- [x] 2.3 Export `detectRtkConflicts` from `src/rtk-compat.ts`; import and call from `index.ts`

---

### 3. `user_bash` routing hook

- [x] 3.1 Add `createLocalBashOperations` import from `@earendil-works/pi-coding-agent` in `index.ts`
- [x] 3.2 Register a `user_bash` handler in `index.ts` (after the `tool_call` handler):
  - Return `undefined` if `event.excludeFromContext === true` (`!!` commands)
  - Apply `applyBashIntercept(event.command, state, projectRoot)` to get routing decision
  - For `routing === "host"` or `routing === "error"`: return `{ operations: { exec: (cmd, cwd, opts) => localOps.exec(result.command, cwd, opts) } }`
  - For `routing === "container"`: return `{ operations: { exec: (cmd, cwd, opts) => localOps.exec(result.command, cwd, opts) } }` (the container exec is already baked into `result.command` by `applyBashIntercept`)

---

### 4. RTK-in-container probe

- [x] 4.1 Add `containerRtkAvailable: boolean` field to the in-memory state (not persisted)
- [x] 4.2 In `src/rtk-compat.ts`, add `probeContainerRtk(projectRoot, state): Promise<boolean>` — runs `devcontainer exec ... -- rtk --version` asynchronously, returns boolean
- [x] 4.3 In the container-ready state transition block in the `tool_call` handler (where `state.devcontainer.starting` is set to `false`), call `probeContainerRtk` asynchronously if `pi.getCommands().some(c => c.name === "rtk")`; update `containerRtkAvailable`; emit `info` notification if false

---

### 5. Documentation update

- [x] 5.1 Add RTK-in-container `postCreateHooks` example to README (copy hook to get `rtk` binary into the container)
- [x] 5.2 Document the `user_bash` routing behaviour in README under the **How it works** section
- [x] 5.3 Update `openspec/changes/rtk-interop/source-spec.md` Status line to `Partially addressed (load order docs + conflict detection + user_bash; absorption fallback pending)`

---

### 6. Tests

- [x] 6.1 Add `tests/rtk-compat.test.ts` with unit tests for `detectRtkConflicts` logic (mock `pi.getAllTools()` and `pi.getCommands()` return values for each scenario in the spec)

---

### 7. Verification

- [x] 7.1 Load `@sherif-fanous/pi-rtk` alongside `pi-dev-worktrees`; confirm `warning` notification fires at `session_start` naming the extension
- [x] 7.2 Load `pi-rtk-optimizer` correctly (via `settings.json` array); confirm `info` advisory does NOT fire
- [x] 7.3 Load `pi-rtk-optimizer` via `pi install` (rank 4); confirm `info` advisory fires with `settings.json` snippet
- [x] 7.4 Run `!npm test` with a worktree active; confirm the command runs inside the worktree directory
- [x] 7.5 Run `!npm test` with container active; confirm the command runs inside the container
- [x] 7.6 Run `!!npm test`; confirm no routing is applied
- [x] 7.7 Start a container with `rtk` absent; confirm one-time `info` advisory is emitted at container-ready
- [x] 7.8 Run `npm test`; confirm all existing tests pass

---

### 8. Commit

- [x] `feat: pi-rtk-optimizer interop — conflict detection, user_bash routing, RTK-in-container probe`
