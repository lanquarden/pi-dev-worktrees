/**
 * dashboard-events.ts — Helpers for emitting pi-worktrees events on the shared event bus.
 * The pi-dashboard bridge forwards all pi.events.emit calls automatically.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { WorktreesState } from "./session.js";
import { invalidateDashboardUi } from "./dashboard-ui.js";

export function emitWorkspaceCreated(
  pi: ExtensionAPI,
  branch: string,
  path: string,
  cwd: string,
): void {
  pi.events.emit("pi-worktrees:workspace-created", {
    type: "worktree",
    branch,
    path,
    cwd,
  });
}

export function emitWorkspaceSwitched(
  pi: ExtensionAPI,
  branch: string | null,
  path: string | null,
  cwd: string,
): void {
  if (branch && path) {
    pi.events.emit("pi-worktrees:workspace-switched", {
      type: "worktree",
      branch,
      path,
      cwd,
    });
  } else {
    pi.events.emit("pi-worktrees:workspace-switched", {
      worktree: null,
      cwd,
    });
  }
}

export function emitWorkspaceOff(pi: ExtensionAPI, cwd: string): void {
  pi.events.emit("pi-worktrees:workspace-switched", {
    worktree: null,
    cwd,
  });
}

export function emitWorkspaceRemoved(
  pi: ExtensionAPI,
  branch: string,
  path: string,
  cwd: string,
): void {
  pi.events.emit("pi-worktrees:workspace-removed", {
    type: "worktree",
    branch,
    path,
    cwd,
  });
}

export function emitDevcontainerStarting(
  pi: ExtensionAPI,
  workspace: string,
  cwd: string,
): void {
  pi.events.emit("pi-worktrees:devcontainer-starting", { workspace, cwd });
}

export function emitDevcontainerReady(
  pi: ExtensionAPI,
  workspace: string,
  cwd: string,
): void {
  pi.events.emit("pi-worktrees:devcontainer-ready", { workspace, cwd });
}

export function emitDevcontainerStopped(
  pi: ExtensionAPI,
  workspace: string,
  cwd: string,
): void {
  pi.events.emit("pi-worktrees:devcontainer-stopped", { workspace, cwd });
}

export function emitStateUpdate(pi: ExtensionAPI, state: WorktreesState): void {
  pi.events.emit("pi-worktrees:state", state);
  invalidateDashboardUi(pi);
}
