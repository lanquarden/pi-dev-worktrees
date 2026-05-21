/**
 * bash-intercept.ts — Bash command routing logic for pi-dev-worktrees.
 *
 * Decision table (first match wins):
 * 1. HOST: prefix → strip prefix, pass through on host, routing="host"
 * 2. git/gh/hub/find commands (bare or via rtk wrapper, including compound
 *    commands with export/cd preamble) → pass through on host unchanged,
 *    routing="host"
 * 3. devcontainer.enabled && starting → replace with "still starting" error
 * 4. devcontainer.enabled && !starting → probe, wrap with devcontainer exec, routing="container"
 * 5. worktree.path set → prepend cd <path> &&, routing="host"
 * 6. fallthrough → pass through unchanged, routing="host"
 *
 * cd safety: wherever a cd is prepended (rules 4+5), we use cdSafe() which
 * emits a clear diagnostic on failure instead of silently passing the wrong
 * cwd to the command.
 *
 * The returned InterceptResult includes a `routing` field so callers
 * (index.ts tool_result hook) can prefix the LLM-visible output with
 * "[host]" or "[container]" for consistent grounding.
 */

import { join } from "node:path";
import { probeContainer, tailContainerLog, readStartupOutcome } from "./devcontainer.js";
import type { WorktreesState } from "./session.js";

/** Timeout in ms after which a still-starting container is considered stuck. */
const CONTAINER_START_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Where a bash command was routed to.
 *
 * - "container" — wrapped in devcontainer exec; ran inside the container
 * - "host"      — ran directly on the host (HOST: prefix, git, worktree cd, passthrough)
 * - "error"     — replaced with an error message (container not ready, startup failed)
 */
export type BashRouting = "container" | "host" | "error";

/**
 * Result of applyBashIntercept.
 * `command` is the (possibly rewritten) command to execute.
 * `routing` tells the caller where the command will run.
 */
export interface InterceptResult {
  command: string;
  routing: BashRouting;
  /** Container ID when routing === "container" (short 12-char form) */
  containerId?: string;
}

/**
 * Shell-safe single-quote wrapping.
 */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Build a cd guard that fails loudly when the directory doesn't exist or is
 * inaccessible, then runs the command. Using this instead of bare `cd X && cmd`
 * ensures the user always sees which path failed and why.
 *
 * Produces:
 *   cd '/the/path' || { echo "pi-dev-worktrees: cannot cd to '/the/path': $?" >&2; exit 1; }; <cmd>
 */
export function cdSafe(dir: string, cmd: string): string {
  const q = shellQuote(dir);
  return (
    `cd ${q} || { echo "pi-dev-worktrees: cannot cd to ${q} (exit $?)" >&2; exit 1; }; ${cmd}`
  );
}

/**
 * Build a human-readable "container not ready" error message.
 * Always includes the startup log tail so the LLM can diagnose the problem
 * immediately without needing to run /devcontainer logs separately.
 */
function containerNotReadyMessage(
  projectRoot: string,
  startedAt: number | undefined,
): string {
  const elapsed = startedAt ? Date.now() - startedAt : undefined;
  const elapsedStr = elapsed !== undefined
    ? `${Math.floor(elapsed / 1000)}s elapsed`
    : "unknown start time";

  const isStuck = elapsed !== undefined && elapsed > CONTAINER_START_TIMEOUT_MS;

  const logTail = tailContainerLog(projectRoot, 30);
  const logSection = logTail
    ? `\n\nStartup log (.pi/devcontainer-up.log):\n${logTail}`
    : "\n\nNo startup log found. The devcontainer CLI may have failed silently.";

  // Check if the startup process has already completed (success or error)
  const { outcome, message: outcomeMsg } = readStartupOutcome(projectRoot);

  if (outcome === "error") {
    const reason = outcomeMsg ? `\nError: ${outcomeMsg}` : "";
    return (
      `Container startup failed.${reason}` +
      `\nRun /devcontainer off then /devcontainer on to retry.` +
      logSection
    );
  }

  if (outcome === "success") {
    // Container up per log but tool_call handler hasn't transitioned state yet.
    // This should only happen on the very first command after startup completes.
    return (
      `Container is up (per startup log) but state not yet updated — this should resolve automatically.` +
      `\nIf this persists, run /devcontainer off + on to reset.` +
      logSection
    );
  }

  if (isStuck) {
    return (
      `Container startup appears stuck (${elapsedStr}, timeout: ${CONTAINER_START_TIMEOUT_MS / 60000}min).` +
      `\nRun /devcontainer off then /devcontainer on to restart.` +
      logSection
    );
  }

  return (
    `Container not ready (${elapsedStr}).` +
    `\nRun /devcontainer logs to view full log, or /devcontainer off + on to restart.` +
    logSection
  );
}

/**
 * Strip common shell preamble (env-var exports, cd statements) to find the
 * effective command for routing purposes.  Only used for Rule 2 detection;
 * the original command is always executed unchanged on the host.
 *
 * Handles patterns like:
 *   export RTK_DB_PATH='/tmp/...'; cd /path/to/repo && git commit ...
 *   VAR=value git status
 */
function effectiveCommand(cmd: string): string {
  let s = cmd.trim();
  // Strip any number of leading `export VAR=value;` or `VAR=value;` lines
  s = s.replace(/^(?:export\s+)?\w+=[^;\n]*;\s*/g, "");
  // Strip a single leading `cd <path> && ` or `cd <path> ; ` block
  s = s.replace(/^cd\s+\S+\s*(?:&&|;)\s*/, "");
  return s.trim();
}

/**
 * Apply bash intercept routing to a command.
 * Returns an InterceptResult with the (possibly modified) command and routing metadata.
 */
export async function applyBashIntercept(
  cmd: string,
  state: WorktreesState,
  projectRoot: string,
): Promise<InterceptResult> {
  // Rule 1: HOST: prefix — strip and pass through on host
  if (/^HOST:/i.test(cmd)) {
    return { command: cmd.replace(/^HOST:/i, "").trimStart(), routing: "host" };
  }

  // Rule 2: git/gh/hub/find — pass through unchanged (always run on host)
  // Also handles:
  //   - compound commands with shell preamble (export VAR=...; cd ... && git ...)
  //   - rtk wrappers (rtk git, rtk gh) used by the RTK optimizer
  const effective = effectiveCommand(cmd);
  if (
    /^(git|gh|hub|find)(\s|$)/.test(cmd) ||
    /^(git|gh|hub|find)(\s|$)/.test(effective) ||
    /^rtk\s+(git|gh)(\s|$)/.test(effective)
  ) {
    return { command: cmd, routing: "host" };
  }

  const dc = state.devcontainer;

  // Rule 3: devcontainer enabled and still starting
  if (dc?.enabled && dc.starting) {
    const msg = containerNotReadyMessage(projectRoot, dc.startedAt);
    return { command: `printf '%s\n' ${shellQuote(msg)} && exit 1`, routing: "error" };
  }

  // Rule 4: devcontainer enabled and not starting — probe and wrap
  if (dc?.enabled && !dc.starting) {
    // Check the startup log first before attempting a slow exec probe.
    // If devcontainer up reported success, trust it and wrap immediately.
    const { outcome, containerId, remoteWorkspaceFolder: logRemoteWorkspace } = readStartupOutcome(projectRoot);
    const alive = outcome === "success" || probeContainer(projectRoot);
    if (!alive) {
      const msg = containerNotReadyMessage(projectRoot, dc.startedAt);
      return { command: `printf '%s\n' ${shellQuote(msg)} && exit 1`, routing: "error" };
    }

    const hostWorkspace = dc.workspace;
    // Prefer remoteWorkspaceFolder from state (set by tool_call handler after
    // startup). Fall back to the value in the startup log — this covers the
    // race where the first bash command fires before the tool_call handler has
    // saved updated state (e.g. session restored from disk, or first command
    // immediately after container-ready notification).
    const containerWorkspace = dc.remoteWorkspaceFolder ?? logRemoteWorkspace ?? hostWorkspace;

    // Build the inner command, cd-guarded so path failures are visible.
    let inner: string;
    if (state.worktree?.path) {
      // Map worktree host path → container-side path by replacing the host
      // workspace prefix with the container workspace prefix.
      const relative = state.worktree.path.startsWith(hostWorkspace)
        ? state.worktree.path.slice(hostWorkspace.length)
        : "";
      const containerWorktreePath = relative
        ? containerWorkspace + relative
        : state.worktree.path; // fallback: hope paths already match
      inner = cdSafe(containerWorktreePath, cmd);
    } else {
      // No worktree: run at the container workspace root.
      // cdSafe ensures we get a clear error if the mount is wrong.
      inner = cdSafe(containerWorkspace, cmd);
    }

    // Escape inner for sh -c '...'
    const innerEscaped = inner.replace(/'/g, "'\\''");

    // Prepend a shell comment with the original command so the TUI header shows
    // something human-readable instead of the full devcontainer exec boilerplate.
    // The shell ignores comment lines; it has no effect on execution.
    //
    // IMPORTANT: collapse newlines to spaces — shell comments only cover a
    // single line.  A multi-line commit message (e.g. `git commit -m "feat:\n-
    // ..."`) would otherwise leak subsequent lines out of the comment,
    // causing the inner shell to parse them as commands and fail with a
    // syntax error.
    const displayComment = `# [container] ${cmd.replace(/\n/g, " ")}\n`;

    // Prefer --container-id when available — it requires no --workspace-folder
    // or --override-config repetition (all context is baked into the running
    // container), and avoids OCI chdir failures caused by a mismatch between
    // the override's workspaceFolder and the actual mount in the container
    // (e.g. when a pre-existing container started with a different config is
    // reused by devcontainer up).
    if (containerId) {
      return {
        command: (
          displayComment +
          `devcontainer exec` +
          ` --container-id ${shellQuote(containerId)}` +
          ` -- sh -c '${innerEscaped}'`
        ),
        routing: "container",
        containerId: containerId.slice(0, 12),
      };
    }

    const overridePath = join(projectRoot, ".pi", "devcontainer.override.json");
    return {
      command: (
        displayComment +
        `devcontainer exec` +
        ` --workspace-folder ${shellQuote(hostWorkspace)}` +
        ` --override-config ${shellQuote(overridePath)}` +
        ` -- sh -c '${innerEscaped}'`
      ),
      routing: "container",
    };
  }

  // Rule 5: worktree active — cd to worktree with failure guard
  if (state.worktree?.path) {
    return { command: cdSafe(state.worktree.path, cmd), routing: "host" };
  }

  // Rule 6: pass through unchanged
  return { command: cmd, routing: "host" };
}
