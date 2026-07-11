# Design: External Worktree Mode, Local Artifact Excludes, and Plain-pi Routing Feedback

## D1 — Configuration schema

**Decision:** Add an optional top-level `worktrees.enabled` boolean to the existing global config.

```ts
interface PluginConfig {
  worktrees?: {
    enabled?: boolean;
  };
  devcontainer?: {
    enabled?: boolean;
  };
  repos?: RepoEntry[];
}
```

Both capabilities default on; only explicit `false` disables one. `repos` becomes optional so a clear Herdr configuration is:

```json
{
  "worktrees": { "enabled": false },
  "devcontainer": { "enabled": true }
}
```

The flags are independent:

| Worktrees | Devcontainer | Behavior |
|---|---|---|
| on | on | Current combined behavior |
| on | off | Extension-managed worktrees with host command routing |
| off | on | External/Herdr worktrees with cwd-rooted devcontainer routing |
| off | off | No workspace/container management; worktree and devcontainer tools inactive |

**Rationale:** Nested capability objects are extensible without accumulating negatively named top-level flags. Independent default-on flags preserve existing installations while making partial use explicit.

**Future option:** A string ownership mode (`managed` / `external`) may be clearer if more than two modes emerge. It is not needed for the first implementation.

---

## D2 — Three distinct roots

**Decision:** Represent these paths separately in `index.ts`:

| Name | Source | Purpose |
|---|---|---|
| `sessionCwd` | `ctx.cwd` at `session_start` | Exact directory where pi was launched |
| `gitRoot` | `git rev-parse --show-toplevel` with `cwd: sessionCwd` | Extension-owned worktree operations only |
| `devcontainerRoot` | managed mode: `gitRoot`; external mode: `sessionCwd` | Every devcontainer lifecycle operation |

Do not persist `sessionCwd` or `devcontainerRoot`; recompute them for every session runtime.

**Rationale:** Treating one `projectRoot` as all three concepts caused the current coupling. In Herdr mode, the launcher has already selected the workspace, so `ctx.cwd` is authoritative. Capturing it again on `/reload`, `/new`, `/resume`, and `/fork` follows pi's session lifecycle.

**Non-Git behavior:** External-worktree mode may operate a devcontainer from `sessionCwd` even when no Git root is available. Worktree-managed mode retains the current Git requirement.

---

## D3 — Scope of disabling worktrees

**Decision:** External-worktree mode disables all extension-owned worktree behavior, not only worktree creation.

The extension SHALL:

- skip remote URL, worktree root, hooks, `.wtp.yml`, and `wtp` initialization;
- clear restored `state.worktree` before routing can occur;
- skip bash cwd and relative file-path worktree rewrites;
- omit worktree context from `before_agent_start`;
- remove `worktree` from `pi.getActiveTools()` via `pi.setActiveTools()`;
- make every worktree tool/command action return a non-mutating "externally managed" response; and
- omit dashboard worktree management contributions and rows.

`/worktree` remains registered because pi has no unregister API and because an explanatory response is better than an unknown command. No worktree action, including `prune`, is allowed to mutate Git metadata owned by Herdr.

**Rationale:** Partial availability creates an ambiguous ownership boundary. External mode should guarantee that this extension cannot change worktrees.

---

## D4 — Devcontainer capability gating

**Decision:** When `devcontainer.enabled` is false, the extension SHALL:

- clear restored `state.devcontainer` before routing or UI updates;
- skip config discovery, override/log generation, probe, RTK-in-container checks, and all container lifecycle calls;
- remove `devcontainer` from `pi.getActiveTools()` while preserving unrelated active tools;
- keep `/devcontainer` registered but return a non-mutating "disabled by config" response for every action;
- skip container bash routing and container context injection; and
- clear its status when no other actionable extension state is active.

The extension SHALL NOT stop a restored container when config disables the capability; another session may still use it.

**Rationale:** A capability flag must prevent side effects, not merely hide commands. Keeping the slash command provides an explanation and matches the worktree gating strategy.

---

## D5 — Restored-state sanitization

**Decision:** Sanitize state during `session_start`, before status, dashboard invalidation, or routing handlers can observe it.

1. In external mode, clear any restored `state.worktree` and append sanitized state once.
2. If devcontainers are disabled by config, clear restored container state without stopping a container.
3. If restored targeting was enabled but `state.devcontainer.workspace` differs from `devcontainerRoot`, discard that targeting reference and automatically probe/start a container for `devcontainerRoot`. Do not stop the differently rooted old container because another session may use it.
4. If the workspace matches but the recorded/probed transparent mount does not place the workspace at the expected cwd, stop the mismatched current-root container and restart with `--remove-existing-container` plus a regenerated override.
5. During reconciliation, persist `{ enabled: true, workspace: devcontainerRoot, starting: true }`, refresh status, and notify that targeting is being restarted for the session cwd.
6. If no devcontainer config exists at `devcontainerRoot` or restart fails synchronously, disable targeting and surface the same diagnostic used by `/devcontainer on`.
7. If restored workspace and mount align, preserve and probe it using `devcontainerRoot`.

**Rationale:** A resumed Herdr session should become usable without a manual off/on cycle. Reconciliation targets only the current cwd. Containers rooted elsewhere are left alone; a container for the current root with the wrong mount is explicitly recreated.

---

## D6 — Devcontainer root threading

**Decision:** Thread `devcontainerRoot` through every devcontainer call and event. In external mode, the following all resolve under `sessionCwd`:

- `.devcontainer/devcontainer.json` / `.devcontainer.json` discovery;
- `.pi/devcontainer.override.json` generation;
- `.pi/devcontainer-up.log` reads and writes;
- `devcontainer up --workspace-folder`;
- `devcontainer exec --workspace-folder` fallback;
- probe and Docker label lookup;
- start, stop, rebuild, and logs; and
- `state.devcontainer.workspace`.

The worktree-to-container path mapping branch in `applyBashIntercept` becomes unreachable in external mode because sanitized state cannot contain `state.worktree`.

**Rationale:** Mixing a cwd-based `up` with root-based probe, logs, labels, or exec would create split state and could reuse the wrong container.

---

## D7 — Persistent plain-pi status

**Decision:** Continue using `ctx.ui.setStatus("pi-dev-worktrees", value)` as the composable status slot, but make the visible value contain only actionable state.

| State | Visible status value |
|---|---|
| Container starting | `container:starting` |
| Container ready | `container:on` |
| No active container | cleared (`undefined`) |

Do not display `pi-dev-worktrees`, `worktrees:external`, or inactive capability names. Worktree branch visibility is delegated to pi's built-in Git branch footer/Herdr rather than duplicated here.

The status is recomputed after startup sanitization and every devcontainer transition.

**Rationale:** The status key already identifies ownership internally. Repeating the package name and externally managed mode consumes footer space without informing an action. `setStatus` composes with pi's footer and other extensions.

---

## D8 — Native custom bash-call rendering

**Decision:** Use pi's documented custom `renderCall` API instead of injecting display comments into executable shell commands.

At session startup in TUI mode:

1. Build a stock definition with `createBashToolDefinition(sessionCwd)`.
2. Register a `bash` wrapper preserving the stock schema, description, execution mode, `execute`, and `renderResult`.
3. Replace only `renderCall` with a renderer that shows the original LLM command plus themed dispatch chips.
4. Keep tool-call mutation hooks for RTK and devcontainer routing unchanged.

Conceptual per-call metadata:

```ts
interface BashDispatchMetadata {
  llmCommand: string;
  routing: "host" | "container" | "error";
  containerId?: string;
  cwd?: string;
  rtk: "none" | "applied" | "fallback";
  hasDevcontainer: boolean;
}
```

Renderer coordination:

- `renderCall` stores `context.invalidate` by `toolCallId` and reads metadata from the dispatch map.
- Before routing metadata exists, it renders the original command without chips.
- The `tool_call` handler stores finalized metadata and invokes the captured invalidator.
- The renderer updates/reuses `context.lastComponent` where practical.
- `tool_result` / completion cleanup deletes dispatch and invalidator entries.

The command is left-justified and the chip group is right-justified against the available render width. Chip order is stable: route (`DEV`, `HOST`, `error`), RTK (`RTK`, optional `fallback`), then managed-worktree `CWD`. Use the callback-provided theme, `visibleWidth`, and `truncateToWidth`; do not hardcode ANSI colors. When both sides cannot fit on one line, retain the command on the first line and right-align chips on a second line rather than violating width. Support collapsed and expanded tool rows without replacing result rendering.

Display rules:

- Show `DEV` for all container calls and include a short container id when known.
- Show `HOST` when host execution is exceptional because devcontainer targeting is active.
- Show `RTK` only when the rewritten command executes; add `fallback` when the original executes instead.
- Show `CWD` only when this extension's managed-worktree routing selects `state.worktree.path`; omit it whenever worktrees are disabled/external.
- Show an error chip for routing errors.
- Keep ordinary host calls with no rewrite visually identical to stock bash calls.
- Remove the current `# [container]` executable display comment once custom rendering is active.

**Compatibility:** Pi has no standalone renderer-decorator registration. Registering `bash` therefore owns that tool definition and may conflict with another extension that also registers `bash`. RTK is compatible today because it rewrites through `tool_call`, not through a bash registration. Before registration, inspect tool source metadata. If another non-built-in bash owner is detected, preserve event-based command routing, do not replace its definition, and emit one warning per session that native routing chips are unavailable.

**Rationale:** Native rendering provides real themed chips, keeps presentation out of shell semantics and LLM output, and preserves the built-in execution/result behavior.

---

## D9 — Distinguish RTK applied from fallback

**Decision:** `rtkRewritten` continues to mean RTK attempted a rewrite. Add an execution-level distinction:

- `none`: post-RTK command equals original LLM command;
- `applied`: rewritten command is the command passed into routing;
- `fallback`: a rewrite was observed, but the original command is used because RTK is unavailable in the target container.

Dashboard consumers may ignore the additive field initially. Plain-pi chips display `RTK fallback` rather than implying that RTK executed.

**Rationale:** The current dashboard chip communicates attempted rewriting, but plain-terminal diagnostics should distinguish what actually ran.

---

## D10 — Parallel-safe result grounding

**Decision:** Replace `lastBashRouting` with `Map<toolCallId, BashDispatchMetadata>`.

- Populate the map after interception.
- Consume and delete the matching entry in `tool_result`.
- Delete pending original-command and dispatch entries on terminal completion paths.
- Preserve `[container]` / `[host]` result prefixes for LLM grounding.
- Continue suppressing `[host]` when no devcontainer exists.

**Rationale:** Pi preflights sibling tool calls sequentially and executes them concurrently. One global routing variable can be overwritten before an earlier call produces its result.

---

## D11 — Non-TUI modes

**Decision:** Routing behavior is mode-independent, but the custom bash wrapper is registered only in TUI mode.

- TUI: actionable status + native dispatch chips + result grounding.
- RPC/dashboard: existing dashboard events/chips + result grounding; no TUI renderer override.
- JSON/print: no UI methods or renderer override; result grounding remains available to the LLM/session.

**Rationale:** Renderer customization is terminal-only and should not change machine-oriented tool registration or payloads.

---

## D12 — Local exclusion of generated artifacts

**Decision:** Add a helper that resolves and updates Git's clone-local exclude file instead of editing `.gitignore`.

Resolution:

```text
git rev-parse --git-path info/exclude
```

The command runs with `cwd: gitRoot`; a relative result is resolved against that cwd. This supports normal repositories, linked worktrees, and external Git directories without assuming `.git` is a directory.

Every code path that creates a file or directory inside the Git worktree/repository SHALL call one generic helper with the absolute generated path. The helper verifies containment in `gitRoot`, converts the path to a slash-normalized root-relative anchored pattern, and appends it only if an equivalent line is absent. The current generated set is:

```text
/.wtp.yml
/.pi/devcontainer.override.json
/.pi/devcontainer-up.log
/.pi/worktrees/
```

For a nested external-mode cwd, paths reflect the actual generated location, for example:

```text
/packages/api/.pi/devcontainer.override.json
/packages/api/.pi/devcontainer-up.log
```

For a configured worktree root inside the repository, add its resolved relative directory pattern when this extension creates/targets it. Do not add an exclusion for an absolute root outside the repository.

Behavioral rules:

- Treat "exclude what we generate" as the invariant; future generation paths must use the same helper rather than extending a hardcoded startup list.
- Add the `.wtp.yml` pattern only when the extension generates that file.
- Add devcontainer override/log patterns when those artifacts are generated or initialized.
- Use an idempotent exact normalized-pattern check; do not repeatedly append entries.
- Create the exclude file or parent directory if Git resolves a valid path that does not yet exist.
- If no Git repository/exclude path is available (valid for external-mode non-Git devcontainers), continue without exclusion and without editing `.gitignore`.
- Remove the current `.gitignore` append logic from `generateOverrideJson`.
- Never remove pre-existing `.gitignore` entries automatically.
- Do not alter tracking of files already committed; Git excludes only affect untracked files.

**Rationale:** These are machine/session artifacts rather than repository policy. `info/exclude` prevents status noise without producing a shared diff. Resolving through Git is necessary for linked worktrees—the exact scenario motivating external ownership.

---

## D13 — Compatibility and migration

- Missing config or missing capability flags: current managed-worktree and devcontainer-enabled behavior.
- Existing `{ "repos": [...] }` config: unchanged.
- Minimal external config may omit `repos`.
- Changing the setting takes effect at the next session start or `/reload`, matching current config load timing.
- Dashboard worktree chips/modal remain available only in managed mode; devcontainer state remains available in either mode.
- Existing `.gitignore` entries previously added by the extension remain untouched; every future in-repository generated artifact uses `info/exclude`.
- Package and command names remain unchanged in this change.
