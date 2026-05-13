/**
 * devcontainer-integration.test.ts — Functional tests using the real devcontainer CLI.
 *
 * These tests start an actual devcontainer and verify the full cycle:
 * - Override config generation with correct workspace mount
 * - devcontainer up with override (workspace mount transparent)
 * - devcontainer exec using --container-id (no workspace-folder repetition needed)
 * - Workspace path is correct inside container
 *
 * Skipped automatically if Docker is not available or SKIP_INTEGRATION=1.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  generateOverrideJson,
  readStartupOutcome,
  containerLogPath,
} from "../src/devcontainer.js";

// Skip if Docker not available or SKIP_INTEGRATION set
const dockerAvailable = (() => {
  try {
    execSync("docker info", { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
})();

const skipIntegration = process.env.SKIP_INTEGRATION === "1" || !dockerAvailable;

/**
 * Run devcontainer up with the given workspace and override config.
 * Returns the parsed JSON outcome line from stdout.
 */
function devcontainerUp(workspaceFolder: string, overridePath: string): {
  outcome: string;
  containerId?: string;
  remoteWorkspaceFolder?: string;
} {
  // Run devcontainer up, capturing all stdout
  const output = execSync(
    `devcontainer up --workspace-folder ${shellQuote(workspaceFolder)} --override-config ${shellQuote(overridePath)}`,
    { encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] }
  );
  // The last JSON line is the outcome
  const lines = output.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith("{")) {
      try {
        return JSON.parse(line) as { outcome: string; containerId?: string; remoteWorkspaceFolder?: string };
      } catch { continue; }
    }
  }
  throw new Error(`No JSON outcome line found in devcontainer up output:\n${output}`);
}

/**
 * Execute a command in a running container by its ID.
 * Uses --container-id so no workspace-folder is needed.
 */
function devcontainerExec(containerId: string, cmd: string): string {
  return execSync(
    `devcontainer exec --container-id ${shellQuote(containerId)} -- sh -c ${shellQuote(cmd)}`,
    { encoding: "utf8", timeout: 30_000 }
  ).trim();
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

describe.skipIf(skipIntegration)("devcontainer integration", () => {
  // Use a temp directory that mirrors an absolute host path — this tests
  // the transparent mount (workspaceMount uses ${localWorkspaceFolder})
  const testWorkspace = join(tmpdir(), `pi-wt-integration-${Date.now()}`);
  let containerId: string | undefined;

  beforeAll(() => {
    // Set up a minimal workspace with a devcontainer config
    mkdirSync(join(testWorkspace, ".devcontainer"), { recursive: true });
    mkdirSync(join(testWorkspace, ".pi"), { recursive: true });

    writeFileSync(
      join(testWorkspace, ".devcontainer", "devcontainer.json"),
      JSON.stringify({
        name: "pi-wt-integration-test",
        image: "mcr.microsoft.com/devcontainers/javascript-node:22",
      })
    );

    // Generate the override with transparent workspace mount
    generateOverrideJson(testWorkspace);
  });

  afterAll(() => {
    // Stop the container if we started one
    if (containerId) {
      try {
        execSync(`docker stop ${containerId}`, { stdio: "ignore", timeout: 30_000 });
      } catch { /* best-effort */ }
    }
    // Clean up temp workspace
    rmSync(testWorkspace, { recursive: true, force: true });
  });

  it("generates override with transparent workspace mount", () => {
    const overridePath = join(testWorkspace, ".pi", "devcontainer.override.json");
    expect(existsSync(overridePath)).toBe(true);

    const override = JSON.parse(readFileSync(overridePath, "utf8"));
    expect(override.workspaceFolder).toBe("${localWorkspaceFolder}");
    expect(override.workspaceMount).toContain("${localWorkspaceFolder}");
    // Must include base image (not just 2-field stub)
    expect(override.image).toBeTruthy();
  });

  it("starts devcontainer and reports success", () => {
    const overridePath = join(testWorkspace, ".pi", "devcontainer.override.json");
    const result = devcontainerUp(testWorkspace, overridePath);
    expect(result.outcome).toBe("success");
    expect(result.containerId).toBeTruthy();
    containerId = result.containerId;
  });

  it("remoteWorkspaceFolder matches host path (transparent mount)", () => {
    // With our workspaceMount override, the container path should equal the host path
    const overridePath = join(testWorkspace, ".pi", "devcontainer.override.json");
    const result = devcontainerUp(testWorkspace, overridePath);
    // devcontainer up is idempotent — re-running reuses existing container
    expect(result.remoteWorkspaceFolder).toBe(testWorkspace);
  });

  it("exec via container-id finds workspace at host path (no workspace-folder needed)", () => {
    expect(containerId).toBeTruthy();
    // Use --container-id only — no --workspace-folder or --override-config needed
    const ls = devcontainerExec(containerId!, `ls ${shellQuote(testWorkspace)}`);
    expect(ls).toContain(".devcontainer");
  });

  it("file written on host is visible inside container at same path", () => {
    expect(containerId).toBeTruthy();
    const testFile = join(testWorkspace, "mount-test.txt");
    writeFileSync(testFile, "hello from host\n");

    const content = devcontainerExec(containerId!, `cat ${shellQuote(testFile)}`);
    expect(content).toBe("hello from host");
  });

  it("file written inside container is visible on host at same path", () => {
    expect(containerId).toBeTruthy();
    const containerPath = join(testWorkspace, "container-test.txt");
    devcontainerExec(containerId!, `sh -c 'echo "hello from container" > ${shellQuote(containerPath)}'`);

    const content = readFileSync(containerPath, "utf8").trim();
    expect(content).toBe("hello from container");
  });
});
