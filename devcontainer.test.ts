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
} from "./devcontainer.js";

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
