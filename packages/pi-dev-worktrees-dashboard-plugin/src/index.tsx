/**
 * MF remote entry point for pi-dev-worktrees-dashboard-plugin.
 *
 * The dashboard host calls `init(api)` after dynamically importing this
 * remote at runtime. `init` registers slot claims and tool renderers via
 * the DashboardPluginApi, then returns a cleanup function for unloading.
 *
 * See change: runtime-plugin-loading (Decision 2: init(api) contract).
 */
import type { DashboardPluginApi } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/api.js";
import { PiDevWorktreesBadge } from "./client/PiDevWorktreesBadge.js";
import { hasPiDevWorktrees } from "./client/predicates.js";
import { EnhancedBashToolRenderer, renderBashDispatchChips, bashDispatchSummary } from "./client/EnhancedBashToolRenderer.js";

/**
 * Called by the host after dynamic import. Registers all slot claims and
 * tool renderers, returning a cleanup function that unregisters everything
 * when the plugin is unloaded.
 */
export function init(api: DashboardPluginApi): () => void {
  const cleanups: Array<() => void> = [];

  // session-card-badge: show worktree + devcontainer state
  cleanups.push(
    api.registerClaim({
      slot: "session-card-badge",
      component: PiDevWorktreesBadge,
      predicate: hasPiDevWorktrees,
    }),
  );

  // tool-renderer: enhanced bash renderer with dispatch chips
  cleanups.push(
    api.registerClaim({
      slot: "tool-renderer",
      toolName: "bash",
      component: EnhancedBashToolRenderer,
      headerChips: renderBashDispatchChips,
      summary: bashDispatchSummary,
    }),
  );

  return () => {
    for (const fn of cleanups) fn();
  };
}
