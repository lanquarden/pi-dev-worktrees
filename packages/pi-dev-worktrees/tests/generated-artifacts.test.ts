import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { excludeGeneratedArtifact, generatedArtifactPattern } from "../src/generated-artifacts.js";

const cleanups: string[] = [];

function temp(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `pi-dev-worktrees-${name}-`));
  cleanups.push(dir);
  return dir;
}

function initRepo(): string {
  const repo = temp("exclude");
  execSync("git init -q", { cwd: repo });
  execSync("git config user.email test@example.com && git config user.name Test", { cwd: repo });
  writeFileSync(join(repo, "tracked.txt"), "tracked\n");
  execSync("git add tracked.txt && git commit -qm init", { cwd: repo });
  return repo;
}

function excludePath(root: string): string {
  const raw = execSync("git rev-parse --git-path info/exclude", { cwd: root, encoding: "utf8" }).trim();
  return isAbsolute(raw) ? raw : resolve(root, raw);
}

afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("generatedArtifactPattern", () => {
  it("anchors and slash-normalizes nested files and directories", () => {
    expect(generatedArtifactPattern("/repo", "/repo/packages/api/.pi/log")).toBe("/packages/api/.pi/log");
    expect(generatedArtifactPattern("/repo", "/repo/.pi/worktrees", true)).toBe("/.pi/worktrees/");
  });

  it("skips paths outside the Git root", () => {
    expect(generatedArtifactPattern("/repo", "/fast-ssd/worktrees", true)).toBeNull();
  });
});

describe("excludeGeneratedArtifact", () => {
  it("updates the Git-resolved local exclude idempotently", () => {
    const repo = initRepo();
    const artifact = join(repo, ".wtp.yml");
    excludeGeneratedArtifact(repo, artifact);
    excludeGeneratedArtifact(repo, artifact);
    const lines = readFileSync(excludePath(repo), "utf8").split(/\r?\n/);
    expect(lines.filter((line) => line === "/.wtp.yml")).toHaveLength(1);
  });

  it("supports nested session cwd artifacts and a representative future artifact", () => {
    const repo = initRepo();
    const nested = join(repo, "packages", "api");
    mkdirSync(nested, { recursive: true });
    excludeGeneratedArtifact(repo, join(nested, ".pi", "devcontainer.override.json"));
    excludeGeneratedArtifact(repo, join(nested, ".pi", "devcontainer-up.log"));
    excludeGeneratedArtifact(repo, join(nested, ".pi", "future.generated"));
    const text = readFileSync(excludePath(repo), "utf8");
    expect(text).toContain("/packages/api/.pi/devcontainer.override.json");
    expect(text).toContain("/packages/api/.pi/devcontainer-up.log");
    expect(text).toContain("/packages/api/.pi/future.generated");
  });

  it("uses Git's linked-worktree exclude path instead of assuming .git is a directory", () => {
    const repo = initRepo();
    const linked = temp("linked");
    rmSync(linked, { recursive: true, force: true });
    execSync(`git worktree add -q -b linked-test ${JSON.stringify(linked)}`, { cwd: repo, shell: "/bin/bash" });
    cleanups.push(linked);
    const artifact = join(linked, ".pi", "devcontainer-up.log");
    excludeGeneratedArtifact(linked, artifact);
    expect(readFileSync(excludePath(linked), "utf8")).toContain("/.pi/devcontainer-up.log");
  });

  it("does not mutate .gitignore and skips out-of-repository paths", () => {
    const repo = initRepo();
    const gitignore = join(repo, ".gitignore");
    const original = "node_modules/\n# user policy\n";
    writeFileSync(gitignore, original);
    excludeGeneratedArtifact(repo, join(temp("outside"), "artifact"));
    expect(readFileSync(gitignore, "utf8")).toBe(original);
  });

  it("is best-effort in a non-Git directory", () => {
    const dir = temp("nongit");
    expect(() => excludeGeneratedArtifact(dir, join(dir, ".pi", "artifact"))).not.toThrow();
  });
});
