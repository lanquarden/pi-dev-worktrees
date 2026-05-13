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

  it("creates override file with expected keys", () => {
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

  it("is idempotent — second call does not overwrite", () => {
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
    expect(first).toBe(second);
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
