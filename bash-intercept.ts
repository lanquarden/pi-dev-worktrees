/**
 * bash-intercept.ts — Bash command routing logic for pi-worktrees.
 *
 * Decision table (first match wins):
 * 1. HOST: prefix → strip prefix, pass through unchanged
 * 2. git/gh/hub commands → pass through unchanged
 * 3. devcontainer.enabled && starting → replace with "still starting" error
 * 4. devcontainer.enabled && !starting → probe, wrap with devcontainer exec
 * 5. worktree.path set → prepend cd <path> &&
 * 6. fallthrough → pass through unchanged
 */

import { join } from "node:path";
import { probeContainer, tailContainerLog, readStartupOutcome } from "./devcontainer.js";
import type { WorktreesState } from "./session.js";

/** Timeout in ms after which a still-starting container is considered stuck. */
const CONTAINER_START_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

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
 * Shell-safe single-quote wrapping.
 */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Apply bash intercept routing to a command.
 * Returns the (possibly modified) command string.
 */
export async function applyBashIntercept(
  cmd: string,
  state: WorktreesState,
  projectRoot: string,
): Promise<string> {
  // Rule 1: HOST: prefix — strip and pass through
  if (/^HOST:/i.test(cmd)) {
    return cmd.replace(/^HOST:/i, "").trimStart();
  }

  // Rule 2: git/gh/hub — pass through unchanged (run on host)
  if (/^(git|gh|hub) /.test(cmd)) {
    return cmd;
  }

  const dc = state.devcontainer;

  // Rule 3: devcontainer enabled and still starting
  if (dc?.enabled && dc.starting) {
    const msg = containerNotReadyMessage(projectRoot, dc.startedAt);
    return `printf '%s\n' ${shellQuote(msg)} && exit 1`;
  }

  // Rule 4: devcontainer enabled and not starting — probe and wrap
  if (dc?.enabled && !dc.starting) {
    // Check the startup log first before attempting a slow exec probe.
    // If devcontainer up reported success, trust it and wrap immediately.
    const { outcome } = readStartupOutcome(projectRoot);
    const alive = outcome === "success" || probeContainer(projectRoot);
    if (!alive) {
      const msg = containerNotReadyMessage(projectRoot, dc.startedAt);
      return `printf '%s\n' ${shellQuote(msg)} && exit 1`;
    }

    const overridePath = join(projectRoot, ".pi", "devcontainer.override.json");
    const workspace = dc.workspace;

    // If worktree is active, cd into it inside the container
    let inner: string;
    if (state.worktree?.path) {
      inner = `cd ${shellQuote(state.worktree.path)} && ${cmd}`;
    } else {
      inner = cmd;
    }

    // Escape inner for sh -c '...'
    const innerEscaped = inner.replace(/'/g, "'\\''");
    return (
      `devcontainer exec` +
      ` --workspace-folder ${shellQuote(workspace)}` +
      ` --override-config ${shellQuote(overridePath)}` +
      ` -- sh -c '${innerEscaped}'`
    );
  }

  // Rule 5: worktree active — prepend cd
  if (state.worktree?.path) {
    return `cd ${shellQuote(state.worktree.path)} && ${cmd}`;
  }

  // Rule 6: pass through unchanged
  return cmd;
}
