/**
 * session.ts — Per-session state management for pi-dev-worktrees.
 * State is persisted to the session file via pi.appendEntry().
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface WorktreesState {
  worktree?: {
    branch: string;
    path: string;
  };
  devcontainer?: {
    enabled: boolean;
    workspace: string;
    starting?: boolean;
    /** Unix ms timestamp when container startup was initiated */
    startedAt?: number;
    /**
     * The workspace folder path as it appears INSIDE the container.
     * Read from the devcontainer up log (remoteWorkspaceFolder).
     * May differ from workspace (host path) when the container uses a
     * non-transparent mount (e.g. /workspaces/<name> instead of the host path).
     */
    remoteWorkspaceFolder?: string;
  };
}

// Module-level live in-memory state shared across all handlers
export let state: WorktreesState = {};

/**
 * Scan session entries for "pi-dev-worktrees:state" custom entries,
 * return the last one's data as WorktreesState, or {} if none found.
 */
export function loadState(ctx: ExtensionContext): WorktreesState {
  const entries = ctx.sessionManager.getEntries();
  let last: WorktreesState | undefined;

  for (const entry of entries) {
    if (entry.type === "custom" && entry.customType === "pi-dev-worktrees:state") {
      last = entry.data as WorktreesState;
    }
  }

  return last ?? {};
}

/**
 * Persist current state to the session file (fire-and-forget).
 */
export function saveState(pi: ExtensionAPI, newState: WorktreesState): void {
  pi.appendEntry("pi-dev-worktrees:state", newState);
}
