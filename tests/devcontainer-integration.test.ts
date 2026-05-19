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
function devcontainerUp(workspaceFolder: string, overridePath: string, removeExisting = false): {
  outcome: string;
  containerId?: string;
  remoteWorkspaceFolder?: string;
} {
  const removeFlag = removeExisting ? " --remove-existing-container" : "";
  // Run devcontainer up, capturing all stdout
  const output = execSync(
    `devcontainer up --workspace-folder ${shellQuote(workspaceFolder)} --override-config ${shellQuote(overridePath)}${removeFlag}`,
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
 * Retries up to 3 times with a 1s delay to handle the brief window between
 * devcontainer up returning outcome:success and the container being exec-ready.
 */
function devcontainerExec(containerId: string, cmd: string, retries = 3): string {
  let lastError: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      const out = execSync(
        `devcontainer exec --container-id ${shellQuote(containerId)} -- sh -c ${shellQuote(cmd)}`,
        { encoding: "utf8", timeout: 30_000 }
      ).trim();
      if (out) return out;
    } catch (err) {
      lastError = err;
    }
    // brief pause before retry
    if (i < retries - 1) execSync("sleep 1", { stdio: "ignore" });
  }
  // Return empty on exhaustion — the exec test assertion will handle it
  if (lastError) throw lastError;
  return "";
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

describe.skipIf(skipIntegration)("devcontainer integration", () => {
  // Use a temp directory under the project repo — must be on the same
  // filesystem that Docker can bind-mount (i.e. /home, not /tmp which on
  // WSL2 is a separate tmpfs that Docker cannot transparently bind-mount).
  const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
  const testWorkspace = join(projectRoot, ".pi", `integration-test-${Date.now()}`);
  let containerId: string | undefined;
  let remoteWorkspaceFolder: string | undefined;

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

    // Start the container once here so individual tests never call devcontainerUp
    // concurrently or redundantly (which can briefly restart the container and
    // cause the immediately-following exec test to see an empty response).
    const overridePath = join(testWorkspace, ".pi", "devcontainer.override.json");
    const result = devcontainerUp(testWorkspace, overridePath);
    containerId = result.containerId;
    remoteWorkspaceFolder = result.remoteWorkspaceFolder;

    // Probe readiness: wait until the workspace is actually accessible inside
    // the container before letting tests run. devcontainer up can return
    // outcome:success while the bind-mount is still being initialised, causing
    // the first exec immediately after beforeAll to return empty output.
    if (containerId) {
      const deadline = Date.now() + 15_000;
      let ready = false;
      while (!ready && Date.now() < deadline) {
        try {
          const cid = containerId;
          const probe = execSync(
            `devcontainer exec --container-id ${shellQuote(cid)} -- sh -c ${shellQuote(`ls ${shellQuote(testWorkspace)}`)}`,
            { encoding: "utf8", timeout: 5000 }
          ).trim();
          if (probe.includes(".devcontainer")) ready = true;
        } catch { /* not ready yet, keep polling */ }
        if (!ready) execSync("sleep 0.5", { stdio: "ignore" });
      }
    }
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
    // Container was started in beforeAll; just verify the stored outcome.
    expect(containerId).toBeTruthy();
  });

  it("remoteWorkspaceFolder matches host path (transparent mount)", () => {
    // With our workspaceMount override, the container path equals the host path.
    // Value captured in beforeAll — no redundant devcontainerUp call that could
    // briefly restart the container and race with the next exec test.
    expect(remoteWorkspaceFolder).toBe(testWorkspace);
  });

  it("exec via container-id finds workspace at host path (no workspace-folder needed)", () => {
    expect(containerId).toBeTruthy();
    // Use --container-id only — no --workspace-folder or --override-config needed
    const ls = devcontainerExec(containerId!, `ls -a ${shellQuote(testWorkspace)}`);
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

  it("--remove-existing-container recreates and returns a new containerId", () => {
    // Reproduces the 'stale 2-weeks-old container' scenario: /devcontainer on
    // should always force-recreate so the override config is applied cleanly.
    expect(containerId).toBeTruthy();
    const overridePath = join(testWorkspace, ".pi", "devcontainer.override.json");

    const oldId = containerId;
    const result = devcontainerUp(testWorkspace, overridePath, /* removeExisting */ true);
    expect(result.outcome).toBe("success");
    expect(result.containerId).toBeTruthy();
    // Container was replaced — new ID
    expect(result.containerId).not.toBe(oldId);
    // Update so afterAll stops the right container
    containerId = result.containerId;
  });
});
