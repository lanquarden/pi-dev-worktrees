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
import { probeContainer } from "./devcontainer.js";
import type { WorktreesState } from "./session.js";

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
    return `echo "Container still starting, please retry in a moment." && exit 1`;
  }

  // Rule 4: devcontainer enabled and not starting — probe and wrap
  if (dc?.enabled && !dc.starting) {
    const alive = probeContainer(projectRoot);
    if (!alive) {
      return `echo "Container still starting, please retry in a moment." && exit 1`;
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
