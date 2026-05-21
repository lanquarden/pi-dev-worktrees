/**
 * rtk-compat.ts — RTK interop helpers for pi-dev-worktrees.
 *
 * Provides:
 * - detectRtkConflicts: checks loaded extensions for known incompatible
 *   configurations at session_start and emits advisory notifications.
 * - probeContainerRtk: probes whether `rtk` is available inside the
 *   devcontainer by running `rtk --version` via devcontainer exec.
 */

import { execSync } from "node:child_process";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { readStartupOutcome } from "./devcontainer.js";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * Inspect loaded extensions for known incompatible or misconfigured RTK setups.
 * Emits advisory notifications via ctx.ui.notify.
 *
 * Called at session_start after project root is resolved.
 */
export function detectRtkConflicts(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): void {
  const allTools = pi.getAllTools();
  const bashTool = allTools.find((t) => t.name === "bash");
  const commands = pi.getCommands();

  // Check A: incompatible bash tool override
  if (bashTool) {
    const path = bashTool.sourceInfo.path;
    const isKnownBadRtk =
      path.includes("pi-rtk") &&
      !path.includes("pi-rtk-optimizer") &&
      !path.includes("pi-dev-worktrees");

    if (isKnownBadRtk) {
      ctx.ui.notify(
        `pi-dev-worktrees: incompatible extension detected — "${path}" uses a spawnHook-based bash override. ` +
          `spawnHook fires after pi-dev-worktrees wraps the command in "devcontainer exec", so it receives the ` +
          `full wrapper instead of the inner command. ` +
          `This will break container routing. ` +
          `Replace it with "pi-rtk-optimizer" (MasuRii/pi-rtk-optimizer), which uses tool_call mutation ` +
          `and composes correctly with pi-dev-worktrees.`,
        "warning",
      );
      return;
    }

    const isUnknownOverride =
      bashTool.sourceInfo.source !== "built-in" &&
      !path.startsWith("<builtin") &&
      !path.includes("pi-dev-worktrees");

    if (isUnknownOverride) {
      ctx.ui.notify(
        `pi-dev-worktrees: the bash tool has been overridden by "${path}", which may interfere with ` +
          `worktree directory injection and devcontainer exec routing.`,
        "warning",
      );
      return;
    }
  }

  // Check B: pi-rtk-optimizer detected — advisory for load order
  const hasRtkOptimizer = commands.some((c) => c.name === "rtk");
  if (hasRtkOptimizer) {
    ctx.ui.notify(
      `pi-dev-worktrees: pi-rtk-optimizer detected. ` +
        `To ensure correct load order (pi-rtk-optimizer mutates commands BEFORE pi-dev-worktrees wraps them), ` +
        `verify both extensions are listed in the same settings.json "extensions" array with pi-rtk-optimizer first:\n` +
        `{\n` +
        `  "extensions": [\n` +
        `    "/path/to/pi-rtk-optimizer",\n` +
        `    "/path/to/pi-dev-worktrees"\n` +
        `  ]\n` +
        `}`,
      "info",
    );
  }
}

/**
 * Shell-safe single-quote wrapping.
 */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Probe whether `rtk` is available inside the devcontainer.
 *
 * Runs `rtk --version` via devcontainer exec using the same exec pattern
 * as the rest of the codebase (--container-id when available, else
 * --workspace-folder + --override-config).
 *
 * Returns true if exit code is 0, false otherwise. Never throws.
 */
export async function probeContainerRtk(
  projectRoot: string,
  containerId: string | undefined,
): Promise<boolean> {
  try {
    if (containerId) {
      execSync(
        `devcontainer exec --container-id ${shellQuote(containerId)} -- rtk --version`,
        { timeout: 10_000, stdio: "ignore" },
      );
    } else {
      const overridePath = join(projectRoot, ".pi", "devcontainer.override.json");
      if (!existsSync(overridePath)) return false;
      execSync(
        `devcontainer exec` +
          ` --workspace-folder ${shellQuote(projectRoot)}` +
          ` --override-config ${shellQuote(overridePath)}` +
          ` -- rtk --version`,
        { timeout: 10_000, stdio: "ignore" },
      );
    }
    return true;
  } catch {
    return false;
  }
}
