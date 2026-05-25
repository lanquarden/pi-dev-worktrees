/**
 * Client entry barrel for the pi-dev-worktrees-dashboard-plugin.
 *
 * Component slots claimed by `pi-dashboard-plugin` in package.json:
 *   - session-card-badge → PiDevWorktreesBadge  (predicate: hasPiDevWorktrees)
 *
 * Registers a custom tool renderer for "bash" that overlays dispatch chips
 * when _pluginData metadata is present on the tool args (patched in by event
 * reducer from pi-dev-worktrees:bash-dispatch events).
 */
import { registerToolRenderer } from "@blackbelt-technology/dashboard-plugin-runtime";
import { EnhancedBashToolRenderer, renderBashDispatchChips, bashDispatchSummary } from "./EnhancedBashToolRenderer.js";

registerToolRenderer("bash", EnhancedBashToolRenderer, {
  headerChips: renderBashDispatchChips,
  summary: bashDispatchSummary,
});

export { hasPiDevWorktrees } from "./predicates.js";
export { PiDevWorktreesBadge } from "./PiDevWorktreesBadge.js";
export { EnhancedBashToolRenderer, renderBashDispatchChips, bashDispatchSummary } from "./EnhancedBashToolRenderer.js";
