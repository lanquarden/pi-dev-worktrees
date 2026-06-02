/**
 * Tests for devcontainer.ts — probe, log tail, override generation, start.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  findDevcontainerConfig,
  generateOverrideJson,
  tailContainerLog,
  containerLogPath,
  stripJsonComments,
  readStartupOutcome,
} from "../src/devcontainer.js";

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `pi-wt-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ── findDevcontainerConfig ───────────────────────────────────────────────────

describe("findDevcontainerConfig", () => {
  let dir: string;
  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("finds .devcontainer/devcontainer.json", () => {
    mkdirSync(join(dir, ".devcontainer"));
    writeFileSync(join(dir, ".devcontainer", "devcontainer.json"), "{}");
    expect(findDevcontainerConfig(dir)).toBe(
      join(dir, ".devcontainer", "devcontainer.json"),
    );
  });

  it("finds .devcontainer.json at root", () => {
    writeFileSync(join(dir, ".devcontainer.json"), "{}");
    expect(findDevcontainerConfig(dir)).toBe(join(dir, ".devcontainer.json"));
  });

  it("returns null when neither exists", () => {
    expect(findDevcontainerConfig(dir)).toBeNull();
  });

  it("prefers .devcontainer/devcontainer.json over root .devcontainer.json", () => {
    mkdirSync(join(dir, ".devcontainer"));
    writeFileSync(join(dir, ".devcontainer", "devcontainer.json"), "{}");
    writeFileSync(join(dir, ".devcontainer.json"), "{}");
    expect(findDevcontainerConfig(dir)).toBe(
      join(dir, ".devcontainer", "devcontainer.json"),
    );
  });
});

// ── generateOverrideJson ─────────────────────────────────────────────────────

describe("generateOverrideJson", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTempDir();
    mkdirSync(join(dir, ".pi"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("without base config: creates override with workspace fields only", () => {
    generateOverrideJson(dir);
    const content = readFileSync(
      join(dir, ".pi", "devcontainer.override.json"),
      "utf8",
    );
    const parsed = JSON.parse(content);
    expect(parsed).toHaveProperty("workspaceMount");
    expect(parsed).toHaveProperty("workspaceFolder");
    expect(parsed.workspaceFolder).toBe("${localWorkspaceFolder}");
  });

  it("merges base config — workspace fields override base values", () => {
    mkdirSync(join(dir, ".devcontainer"));
    writeFileSync(
      join(dir, ".devcontainer", "devcontainer.json"),
      JSON.stringify({
        image: "ubuntu:22.04",
        workspaceFolder: "/wrong",
        containerUser: "vscode",
      }),
    );
    generateOverrideJson(dir);
    const parsed = JSON.parse(
      readFileSync(join(dir, ".pi", "devcontainer.override.json"), "utf8"),
    );
    // Workspace overrides win
    expect(parsed.workspaceFolder).toBe("${localWorkspaceFolder}");
    expect(parsed.workspaceMount).toContain("${localWorkspaceFolder}");
    // Base fields preserved
    expect(parsed.image).toBe("ubuntu:22.04");
    expect(parsed.containerUser).toBe("vscode");
  });

  it("strips JSON comments when parsing base config", () => {
    mkdirSync(join(dir, ".devcontainer"));
    writeFileSync(
      join(dir, ".devcontainer", "devcontainer.json"),
      // devcontainer.json files commonly include comments
      '{ "image": "ubuntu:22.04" // the base image\n}',
    );
    generateOverrideJson(dir);
    const parsed = JSON.parse(
      readFileSync(join(dir, ".pi", "devcontainer.override.json"), "utf8"),
    );
    expect(parsed.image).toBe("ubuntu:22.04");
  });

  it("regenerates if existing override is the old 2-field stub", () => {
    // Write the old stub that was created by the previous version
    writeFileSync(
      join(dir, ".pi", "devcontainer.override.json"),
      JSON.stringify({
        workspaceMount:
          "source=${localWorkspaceFolder},target=${localWorkspaceFolder},type=bind",
        workspaceFolder: "${localWorkspaceFolder}",
      }),
    );
    mkdirSync(join(dir, ".devcontainer"));
    writeFileSync(
      join(dir, ".devcontainer", "devcontainer.json"),
      JSON.stringify({ image: "alpine:3.18" }),
    );
    generateOverrideJson(dir);
    const parsed = JSON.parse(
      readFileSync(join(dir, ".pi", "devcontainer.override.json"), "utf8"),
    );
    // Should now include the base image field
    expect(parsed.image).toBe("alpine:3.18");
  });

  it("leaves user-customised override untouched (not the 2-field stub)", () => {
    const custom = {
      image: "ubuntu:22.04",
      workspaceFolder: "${localWorkspaceFolder}",
      workspaceMount: "source=${localWorkspaceFolder},target=${localWorkspaceFolder},type=bind",
      remoteUser: "dev",
    };
    writeFileSync(
      join(dir, ".pi", "devcontainer.override.json"),
      JSON.stringify(custom),
    );
    generateOverrideJson(dir);
    const parsed = JSON.parse(
      readFileSync(join(dir, ".pi", "devcontainer.override.json"), "utf8"),
    );
    // Should be unchanged
    expect(parsed.remoteUser).toBe("dev");
    expect(parsed.image).toBe("ubuntu:22.04");
  });

  it("is idempotent when no base config and not a stub (second call skips)", () => {
    generateOverrideJson(dir);
    const first = readFileSync(
      join(dir, ".pi", "devcontainer.override.json"),
      "utf8",
    );
    generateOverrideJson(dir);
    const second = readFileSync(
      join(dir, ".pi", "devcontainer.override.json"),
      "utf8",
    );
    // First call produces 2-field stub (no base config), second call detects it
    // as a stub and would regenerate — but with no base config again, result is same
    expect(JSON.parse(first).workspaceFolder).toBe("${localWorkspaceFolder}");
    expect(JSON.parse(second).workspaceFolder).toBe("${localWorkspaceFolder}");
  });

  it("adds pattern to .gitignore", () => {
    generateOverrideJson(dir);
    const gitignore = readFileSync(join(dir, ".gitignore"), "utf8");
    expect(gitignore).toContain(".pi/devcontainer.override.json");
  });

  it("does not duplicate pattern if already in .gitignore", () => {
    writeFileSync(join(dir, ".gitignore"), ".pi/devcontainer.override.json\n");
    generateOverrideJson(dir);
    const gitignore = readFileSync(join(dir, ".gitignore"), "utf8");
    const count = (
      gitignore.match(/\.pi\/devcontainer\.override\.json/g) ?? []
    ).length;
    expect(count).toBe(1);
  });

  it("appends correctly to non-empty .gitignore without extra blank line", () => {
    writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
    generateOverrideJson(dir);
    const gitignore = readFileSync(join(dir, ".gitignore"), "utf8");
    expect(gitignore).toContain("node_modules/\n.pi/devcontainer.override.json\n");
  });
});

// ── stripJsonComments ─────────────────────────────────────────────────────────

describe("stripJsonComments", () => {
  it("strips single-line comments", () => {
    const json = `{ "key": "value" // comment\n}`;
    const result = JSON.parse(stripJsonComments(json));
    expect(result.key).toBe("value");
  });

  it("strips multi-line comments", () => {
    const json = `{ /* block comment */ "key": "value" }`;
    const result = JSON.parse(stripJsonComments(json));
    expect(result.key).toBe("value");
  });

  it("does not strip URLs", () => {
    const json = `{ "url": "https://example.com" }`;
    const result = JSON.parse(stripJsonComments(json));
    expect(result.url).toBe("https://example.com");
  });

  it("strips comment-only lines", () => {
    const json = `{\n// top comment\n"key": 1\n}`;
    const result = JSON.parse(stripJsonComments(json));
    expect(result.key).toBe(1);
  });
});

// ── tailContainerLog ─────────────────────────────────────────────────────────

describe("tailContainerLog", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTempDir();
    mkdirSync(join(dir, ".pi"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("returns empty string when no log file exists", () => {
    expect(tailContainerLog(dir)).toBe("");
  });

  it("returns all lines when fewer than the requested tail count", () => {
    writeFileSync(containerLogPath(dir), "line1\nline2\nline3\n");
    expect(tailContainerLog(dir, 20)).toBe("line1\nline2\nline3");
  });

  it("returns only the last N lines when log has more", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line${i + 1}`);
    writeFileSync(containerLogPath(dir), lines.join("\n") + "\n");
    const result = tailContainerLog(dir, 10);
    const resultLines = result.split("\n");
    expect(resultLines).toHaveLength(10);
    expect(resultLines[0]).toBe("line41");
    expect(resultLines[9]).toBe("line50");
  });

  it("handles empty log file", () => {
    writeFileSync(containerLogPath(dir), "");
    expect(tailContainerLog(dir)).toBe("");
  });
});

// ── containerLogPath ─────────────────────────────────────────────────────────

describe("containerLogPath", () => {
  it("returns path under .pi/", () => {
    expect(containerLogPath("/my/project")).toBe(
      "/my/project/.pi/devcontainer-up.log",
    );
  });
});

// ── readStartupOutcome ────────────────────────────────────────────────────────

describe("readStartupOutcome", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTempDir();
    mkdirSync(join(dir, ".pi"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("returns null when no log file exists", () => {
    expect(readStartupOutcome(dir).outcome).toBeNull();
  });

  it("detects success outcome from final JSON line", () => {
    const log =
      "--- devcontainer up started at 2026-01-01T00:00:00Z ---\n" +
      "[2026-01-01T00:00:01Z] @devcontainers/cli 0.80.2\n" +
      '{"outcome":"success","containerId":"abc123","remoteUser":"vscode","remoteWorkspaceFolder":"/workspaces/myrepo"}\n';
    writeFileSync(containerLogPath(dir), log);
    const result = readStartupOutcome(dir);
    expect(result.outcome).toBe("success");
    expect(result.remoteWorkspaceFolder).toBe("/workspaces/myrepo");
  });

  it("detects error outcome and extracts message", () => {
    const msg = "Dev container config is missing one of \"image\", \"dockerFile\" or \"dockerComposeFile\" properties.";
    const log =
      "--- devcontainer up started at 2026-01-01T00:00:00Z ---\n" +
      `{"outcome":"error","message":${JSON.stringify(msg)},"description":${JSON.stringify(msg)}}\n`;
    writeFileSync(containerLogPath(dir), log);
    const result = readStartupOutcome(dir);
    expect(result.outcome).toBe("error");
    expect(result.message).toContain("missing one of");
  });

  it("returns null when log is still being written (no JSON line yet)", () => {
    const log =
      "--- devcontainer up started at 2026-01-01T00:00:00Z ---\n" +
      "[2026-01-01T00:00:01Z] @devcontainers/cli 0.80.2\n" +
      "[2026-01-01T00:00:02Z] Starting container...\n";
    writeFileSync(containerLogPath(dir), log);
    expect(readStartupOutcome(dir).outcome).toBeNull();
  });

  it("finds JSON line even when followed by trailing text", () => {
    // Some devcontainer versions print extra lines after the JSON
    const log =
      '{"outcome":"success","containerId":"abc"}\n' +
      "Some extra output\n";
    writeFileSync(containerLogPath(dir), log);
    // Scans from end — "Some extra output" is not JSON, so finds the success line
    expect(readStartupOutcome(dir).outcome).toBe("success");
  });
});

// ── clearStartupLog ───────────────────────────────────────────────────────────

import { clearStartupLog } from "../src/devcontainer.js";

describe("clearStartupLog", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTempDir();
    mkdirSync(join(dir, ".pi"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("empties the log file when it exists", () => {
    writeFileSync(containerLogPath(dir), '{"outcome":"success"}\n');
    clearStartupLog(dir);
    expect(readFileSync(containerLogPath(dir), "utf8")).toBe("");
  });

  it("does nothing (no throw) when log file does not exist", () => {
    expect(() => clearStartupLog(dir)).not.toThrow();
  });

  it("after clearing, readStartupOutcome returns null", () => {
    writeFileSync(containerLogPath(dir), '{"outcome":"success"}\n');
    clearStartupLog(dir);
    expect(readStartupOutcome(dir).outcome).toBeNull();
  });
});

// ── generateOverrideJson force flag ──────────────────────────────────────────

describe("generateOverrideJson — force regeneration", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTempDir();
    mkdirSync(join(dir, ".pi"));
    mkdirSync(join(dir, ".devcontainer"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("force=true regenerates even a user-customised override", () => {
    const custom = {
      image: "ubuntu:22.04",
      workspaceFolder: "${localWorkspaceFolder}",
      workspaceMount: "source=${localWorkspaceFolder},target=${localWorkspaceFolder},type=bind",
      remoteUser: "old-user",
    };
    writeFileSync(join(dir, ".pi", "devcontainer.override.json"), JSON.stringify(custom));
    writeFileSync(join(dir, ".devcontainer", "devcontainer.json"), JSON.stringify({ image: "ubuntu:24.04" }));

    generateOverrideJson(dir, undefined, /* force */ true);

    const parsed = JSON.parse(readFileSync(join(dir, ".pi", "devcontainer.override.json"), "utf8"));
    // Should be regenerated from the new base config
    expect(parsed.image).toBe("ubuntu:24.04");
    // remoteUser not in new base, so not present (or workspace overrides applied)
    expect(parsed.workspaceFolder).toBe("${localWorkspaceFolder}");
  });

  it("force=false leaves user-customised override untouched", () => {
    const custom = {
      image: "ubuntu:22.04",
      workspaceFolder: "${localWorkspaceFolder}",
      workspaceMount: "source=${localWorkspaceFolder},target=${localWorkspaceFolder},type=bind",
      remoteUser: "my-user",
    };
    writeFileSync(join(dir, ".pi", "devcontainer.override.json"), JSON.stringify(custom));
    writeFileSync(join(dir, ".devcontainer", "devcontainer.json"), JSON.stringify({ image: "ubuntu:24.04" }));

    generateOverrideJson(dir, undefined, /* force */ false);

    const parsed = JSON.parse(readFileSync(join(dir, ".pi", "devcontainer.override.json"), "utf8"));
    expect(parsed.remoteUser).toBe("my-user"); // unchanged
  });
});

// ── buildStartArgs ────────────────────────────────────────────────────────────

import { buildStartArgs } from "../src/devcontainer.js";

describe("buildStartArgs", () => {
  const ROOT = "/my/project";
  const OVERRIDE = "/my/project/.pi/devcontainer.override.json";

  it("includes --workspace-folder and --override-config without removeExisting", () => {
    const args = buildStartArgs(ROOT, OVERRIDE, false);
    expect(args).toContain("up");
    expect(args).toContain("--workspace-folder");
    expect(args).toContain(ROOT);
    expect(args).toContain("--override-config");
    expect(args).toContain(OVERRIDE);
    expect(args).not.toContain("--remove-existing-container");
  });

  it("appends --remove-existing-container when removeExisting=true", () => {
    const args = buildStartArgs(ROOT, OVERRIDE, true);
    expect(args).toContain("--remove-existing-container");
  });

  it("does NOT include --remove-existing-container when removeExisting=false", () => {
    const args = buildStartArgs(ROOT, OVERRIDE, false);
    expect(args).not.toContain("--remove-existing-container");
  });

  it("order: up, --workspace-folder, path, --override-config, path [, --remove-existing-container]", () => {
    const args = buildStartArgs(ROOT, OVERRIDE, true);
    expect(args[0]).toBe("up");
    expect(args[args.indexOf("--workspace-folder") + 1]).toBe(ROOT);
    expect(args[args.indexOf("--override-config") + 1]).toBe(OVERRIDE);
    expect(args[args.length - 1]).toBe("--remove-existing-container");
  });

  it("appends --build-no-cache when noCache=true", () => {
    const args = buildStartArgs(ROOT, OVERRIDE, false, true);
    expect(args).toContain("--build-no-cache");
  });

  it("does NOT include --build-no-cache when noCache=false (default)", () => {
    const args = buildStartArgs(ROOT, OVERRIDE, false);
    expect(args).not.toContain("--build-no-cache");
  });

  it("--build-no-cache appears after --remove-existing-container when both are set", () => {
    const args = buildStartArgs(ROOT, OVERRIDE, true, true);
    const removeIdx = args.indexOf("--remove-existing-container");
    const noCacheIdx = args.indexOf("--build-no-cache");
    expect(removeIdx).toBeGreaterThan(-1);
    expect(noCacheIdx).toBeGreaterThan(removeIdx);
  });
});
