/**
 * devcontainer-cli.integration.test.ts — end-to-end tests invoking the devcontainers CLI
 * against tiny fixture devcontainer folders. Verifies build, run, exec, and --build-no-cache.
 *
 * Skips automatically if Docker or devcontainer CLI is unavailable, or SKIP_INTEGRATION=1.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  generateOverrideJson,
} from "../src/devcontainer.js";

function dockerOk(): boolean {
  try { execSync("docker info", { stdio: "ignore", timeout: 5000 }); return true; } catch { return false; }
}
function devcontainerOk(): boolean {
  try { execSync("devcontainer --help", { stdio: "ignore", timeout: 5000 }); return true; } catch { return false; }
}
const skip = process.env.SKIP_INTEGRATION === "1" || !dockerOk() || !devcontainerOk();

function shq(s: string): string { return `'${s.replace(/'/g, "'\\''")}'`; }

function up(workspace: string, overridePath: string, extra: string[] = []): { outcome: string; containerId?: string } {
  const cmd = [
    "devcontainer", "up",
    "--workspace-folder", workspace,
    "--override-config", overridePath,
    ...extra,
  ];
  const out = execSync(cmd.map(shq).join(" "), { encoding: "utf8", timeout: 180_000 });
  const lines = out.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith("{")) {
      try { return JSON.parse(line) as { outcome: string; containerId?: string }; } catch {}
    }
  }
  throw new Error("devcontainer up did not print outcome JSON");
}

function execById(containerId: string, cmd: string): string {
  const out = execSync(`devcontainer exec --container-id ${shq(containerId)} -- sh -c ${shq(cmd)}`, { encoding: "utf8", timeout: 60_000 });
  return out.trim();
}

// Use a separately created temp working copy for each suite to avoid collisions
function makeScratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-wt-dc-fixture-"));
  mkdirSync(join(dir, ".pi"));
  return dir;
}

// Copies a fixture (tests/fixtures/<name>) into the scratch workspace
function scaffoldFixture(scratch: string, name: string): string {
  const srcBase = new URL(`./fixtures/${name}/`, import.meta.url).pathname;
  // Copy contents of the fixture directory into scratch root
  execSync(`cp -R ${shq(srcBase + ".")} ${shq(scratch)}`);
  return scratch;
}

// Note: Each describe.skipIf guards on global skip, and per-test use remove-existing to avoid reuse

describe.skipIf(skip)("devcontainer CLI fixture: image", () => {
  const ws = makeScratch();
  scaffoldFixture(ws, "image");
  let containerId: string | undefined;

  afterAll(() => { if (containerId) { try { execSync(`docker stop ${shq(containerId)}`); } catch {} } rmSync(ws, { recursive: true, force: true }); });

  it("builds and runs from image, and mount is transparent", () => {
    generateOverrideJson(ws);
    const override = join(ws, ".pi", "devcontainer.override.json");
    // Sanity: override should include base image
    const parsed = JSON.parse(readFileSync(override, "utf8"));
    expect(parsed.image || parsed.build || parsed.dockerFile || parsed.dockerComposeFile).toBeTruthy();

    const res = up(ws, override, ["--remove-existing-container"]);
    expect(res.outcome).toBe("success");
    expect(res.containerId).toBeTruthy();
    containerId = res.containerId;

    // create a file on host and read in container at same path
    const p = join(ws, "hello.txt");
    writeFileSync(p, "hi\n");
    const got = execById(containerId!, `cat ${shq(p)}`);
    expect(got).toBe("hi");
  });
});

describe.skipIf(skip)("devcontainer CLI fixture: dockerfile", () => {
  const ws = makeScratch();
  scaffoldFixture(ws, "dockerfile");
  let containerId: string | undefined;

  afterAll(() => { if (containerId) { try { execSync(`docker stop ${shq(containerId)}`); } catch {} } rmSync(ws, { recursive: true, force: true }); });

  it("builds from Dockerfile and sets a marker layer", () => {
    generateOverrideJson(ws);
    const override = join(ws, ".pi", "devcontainer.override.json");
    const res = up(ws, override, ["--remove-existing-container"]);
    expect(res.outcome).toBe("success");
    containerId = res.containerId;

    const marker = execById(containerId!, "cat /marker || true");
    // Marker exists only when Dockerfile RUN executed
    expect(marker).toContain("built-from-dockerfile");
  });
});

describe.skipIf(skip)("devcontainer CLI fixture: --build-no-cache forces rebuild", () => {
  const ws = makeScratch();
  scaffoldFixture(ws, "build-nocache");
  let containerId: string | undefined;

  afterAll(() => { if (containerId) { try { execSync(`docker stop ${shq(containerId)}`); } catch {} } rmSync(ws, { recursive: true, force: true }); });

  it("rebuilds image with --build-no-cache, changing ARG marker", () => {
    generateOverrideJson(ws);
    const override = join(ws, ".pi", "devcontainer.override.json");

    // First build without no-cache; marker should be "default"
    let res = up(ws, override, ["--remove-existing-container"]);
    expect(res.outcome).toBe("success");
    containerId = res.containerId;
    let marker = execById(containerId!, "cat /marker || true");
    expect(marker).toContain("marker=default");

    // Stop container, change build arg via override (simulate new build marker)
    try { execSync(`docker stop ${shq(containerId!)}`); } catch {}

    // Update devcontainer.json build args to a new value
    const dcPath = join(ws, ".devcontainer", "devcontainer.json");
    const cfg = JSON.parse(readFileSync(dcPath, "utf8"));
    cfg.build.args.BUILD_NO_CACHE_MARK = `changed-${Date.now()}`;
    writeFileSync(dcPath, JSON.stringify(cfg));

    // Re-generate override to capture any changes, then rebuild with --build-no-cache
    generateOverrideJson(ws, dcPath, true);
    res = up(ws, override, ["--remove-existing-container", "--build-no-cache"]);
    expect(res.outcome).toBe("success");
    containerId = res.containerId;

    marker = execById(containerId!, "cat /marker || true");
    expect(marker).toContain("changed-");
  });
});
