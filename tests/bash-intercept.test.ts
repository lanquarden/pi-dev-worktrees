/**
 * Tests for bash-intercept.ts decision table and devcontainer diagnostics.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock devcontainer module so probeContainer / tailContainerLog / readStartupOutcome are controllable
vi.mock("../src/devcontainer.js", () => ({
  probeContainer: vi.fn(),
  tailContainerLog: vi.fn(),
  readStartupOutcome: vi.fn(),
}));

import { probeContainer, tailContainerLog, readStartupOutcome } from "../src/devcontainer.js";
import { applyBashIntercept } from "../src/bash-intercept.js";
import type { WorktreesState } from "../src/session.js";
import type { BashRouting } from "../src/bash-intercept.js";

const probe = probeContainer as ReturnType<typeof vi.fn>;
const tail = tailContainerLog as ReturnType<typeof vi.fn>;
const startupOutcome = readStartupOutcome as ReturnType<typeof vi.fn>;

const ROOT = "/project";

function emptyState(): WorktreesState {
  return {};
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function intercept(cmd: string, state: WorktreesState): Promise<string> {
  return (await applyBashIntercept(cmd, state, ROOT)).command;
}

async function interceptRouting(cmd: string, state: WorktreesState): Promise<BashRouting> {
  return (await applyBashIntercept(cmd, state, ROOT)).routing;
}

// ── Rule 1: HOST: prefix ─────────────────────────────────────────────────────

describe("Rule 1 — HOST: prefix strips prefix and passes through", () => {
  it("strips HOST: (uppercase)", async () => {
    expect(await intercept("HOST: npm install", emptyState())).toBe("npm install");
  });

  it("strips host: (lowercase)", async () => {
    expect(await intercept("host: npm install", emptyState())).toBe("npm install");
  });

  it("strips HOST: even when devcontainer is active", async () => {
    const state: WorktreesState = {
      devcontainer: { enabled: true, workspace: ROOT, starting: false },
    };
    // probe should NOT be called — HOST: wins immediately
    expect(await intercept("HOST: ls", state)).toBe("ls");
    expect(probe).not.toHaveBeenCalled();
  });
});

// ── Rule 2: git/gh/hub pass-through ──────────────────────────────────────────

describe("Rule 2 — git/gh/hub pass through unchanged", () => {
  const containerState: WorktreesState = {
    devcontainer: { enabled: true, workspace: ROOT, starting: false },
    worktree: { branch: "feature/x", path: "/project/.pi/worktrees/feature/x" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    probe.mockReturnValue(true);
    startupOutcome.mockReturnValue({ outcome: null });
  });

  it("passes git commands through", async () => {
    expect(await intercept("git status", containerState)).toBe("git status");
    expect(probe).not.toHaveBeenCalled();
  });

  it("passes gh commands through", async () => {
    expect(await intercept("gh pr list", containerState)).toBe("gh pr list");
  });

  it("passes hub commands through", async () => {
    expect(await intercept("hub pull-request", containerState)).toBe("hub pull-request");
  });

  it("does NOT match 'github-cli ...' (only exact prefix)", async () => {
    // Should not match Rule 2, so falls through to container wrapping
    const result = await intercept("github-cli status", containerState);
    expect(result).toContain("devcontainer exec");
  });
});

// ── Rule 3: devcontainer starting ────────────────────────────────────────────

describe("Rule 3 — devcontainer enabled and starting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startupOutcome.mockReturnValue({ outcome: null }); // default: still in progress
  });

  const startingState = (startedAt?: number): WorktreesState => ({
    devcontainer: { enabled: true, workspace: ROOT, starting: true, startedAt },
  });

  it("returns exit 1 command while starting", async () => {
    tail.mockReturnValue("");
    const result = await intercept("npm test", startingState(Date.now()));
    expect(result).toContain("exit 1");
  });

  it("mentions elapsed time", async () => {
    tail.mockReturnValue("");
    const startedAt = Date.now() - 30_000; // 30s ago
    const result = await intercept("npm test", startingState(startedAt));
    expect(result).toMatch(/\d+s elapsed/);
  });

  it("does NOT probe the container while starting (Rule 3 fires first)", async () => {
    tail.mockReturnValue("");
    await intercept("npm test", startingState(Date.now()));
    expect(probe).not.toHaveBeenCalled();
  });

  it("shows 'stuck' message with log tail after timeout", async () => {
    const FIVE_MIN = 5 * 60 * 1000;
    const startedAt = Date.now() - FIVE_MIN - 1000; // just past timeout
    tail.mockReturnValue("Error: image not found\nPull failed");
    const result = await intercept("npm test", startingState(startedAt));
    expect(result).toContain("stuck");
    expect(result).toContain("Error: image not found");
    expect(result).toContain("devcontainer-up.log");
  });

  it("mentions restart hint when stuck", async () => {
    const startedAt = Date.now() - 6 * 60 * 1000;
    tail.mockReturnValue("");
    const result = await intercept("npm test", startingState(startedAt));
    expect(result).toContain("/devcontainer off");
  });

  it("includes log tail immediately (before timeout) so LLM can diagnose without extra command", async () => {
    tail.mockReturnValue("Error: missing image field");
    const startedAt = Date.now() - 10_000; // only 10s in, well before timeout
    const result = await intercept("npm test", startingState(startedAt));
    // Log tail should be included regardless of whether we're past the timeout
    expect(result).toContain("Error: missing image field");
  });

  it("mentions /devcontainer logs hint even when not stuck", async () => {
    tail.mockReturnValue("");
    const result = await intercept("npm test", startingState(Date.now()));
    expect(result).toContain("/devcontainer logs");
  });

  it("shows 'startup failed' message when outcome=error", async () => {
    tail.mockReturnValue("Error: image not found");
    startupOutcome.mockReturnValue({
      outcome: "error",
      message: "Dev container config is missing image property.",
    });
    const result = await intercept("npm test", startingState(Date.now()));
    expect(result).toContain("startup failed");
    expect(result).toContain("missing image property");
    expect(result).toContain("/devcontainer off");
  });

  it("shows 'up per log but state not yet updated' when outcome=success", async () => {
    tail.mockReturnValue("outcome:success line");
    startupOutcome.mockReturnValue({ outcome: "success" });
    const result = await intercept("npm test", startingState(Date.now() - 5_000));
    expect(result).toContain("state not yet updated");
    expect(result).toContain("resolve automatically");
  });
});

// ── Rule 4: devcontainer running — probe and wrap ─────────────────────────────

describe("Rule 4 — devcontainer enabled, not starting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startupOutcome.mockReturnValue({ outcome: null });
  });

  const runningState: WorktreesState = {
    devcontainer: { enabled: true, workspace: ROOT, starting: false, startedAt: Date.now() - 60_000 },
  };

  it("skips exec probe and wraps command when startup log says success", async () => {
    probe.mockReturnValue(false); // probe would fail
    startupOutcome.mockReturnValue({ outcome: "success" });
    const result = await intercept("npm test", runningState);
    expect(result).toContain("devcontainer exec");
    expect(probe).not.toHaveBeenCalled();
  });

  it("falls back to exec probe when no startup outcome in log", async () => {
    probe.mockReturnValue(true);
    startupOutcome.mockReturnValue({ outcome: null });
    const result = await intercept("npm test", runningState);
    expect(result).toContain("devcontainer exec");
    expect(probe).toHaveBeenCalledOnce();
  });

  it("wraps command with devcontainer exec when alive", async () => {
    probe.mockReturnValue(true);
    const result = await intercept("npm test", runningState);
    expect(result).toContain("devcontainer exec");
    expect(result).toContain("--workspace-folder");
    expect(result).toContain("npm test");
  });

  it("returns error when probe fails (container stopped)", async () => {
    probe.mockReturnValue(false);
    tail.mockReturnValue("");
    const result = await intercept("npm test", runningState);
    expect(result).toContain("exit 1");
    expect(result).not.toContain("devcontainer exec");
  });

  it("wraps with cd to worktree using host path when no remoteWorkspaceFolder", async () => {
    probe.mockReturnValue(true);
    const state: WorktreesState = {
      devcontainer: { enabled: true, workspace: ROOT, starting: false },
      worktree: { branch: "feature/auth", path: "/project/.pi/worktrees/feature/auth" },
    };
    const result = await intercept("npm test", state);
    expect(result).toContain("devcontainer exec");
    expect(result).toContain("/project/.pi/worktrees/feature/auth");
    expect(result).toContain("npm test");
  });

  it("maps worktree path to container-side path when remoteWorkspaceFolder differs", async () => {
    probe.mockReturnValue(true);
    // Simulate: host=/project, container=/workspaces/myrepo
    const state: WorktreesState = {
      devcontainer: {
        enabled: true,
        workspace: ROOT,
        starting: false,
        remoteWorkspaceFolder: "/workspaces/myrepo",
      },
      worktree: { branch: "feature/auth", path: "/project/.pi/worktrees/feature/auth" },
    };
    const result = await intercept("npm test", state);
    // cd should use container-side prefix, not host prefix
    expect(result).toContain("/workspaces/myrepo/.pi/worktrees/feature/auth");
    expect(result).not.toContain("cd '/project/");
  });


  it("uses --override-config pointing at .pi/devcontainer.override.json", async () => {
    probe.mockReturnValue(true);
    const result = await intercept("echo hi", runningState);
    expect(result).toContain("--override-config");
    expect(result).toContain(".pi/devcontainer.override.json");
  });
});

// ── Rule 5: worktree active, no container ─────────────────────────────────────

describe("Rule 5 — worktree active, no container", () => {
  beforeEach(() => vi.clearAllMocks());

  const worktreeState: WorktreesState = {
    worktree: { branch: "feature/foo", path: "/project/.pi/worktrees/feature/foo" },
  };

  it("prepends cd (with failure guard) to the worktree path", async () => {
    const result = await intercept("npm test", worktreeState);
    // cdSafe: cd '<path>' || { echo "pi-worktrees: ..." >&2; exit 1; }; <cmd>
    expect(result).toContain("cd '/project/.pi/worktrees/feature/foo'");
    expect(result).toContain("pi-worktrees: cannot cd to");
    expect(result).toContain("npm test");
    expect(probe).not.toHaveBeenCalled();
  });

  it("handles paths with spaces", async () => {
    const s: WorktreesState = {
      worktree: { branch: "feature/my feature", path: "/project/.pi/worktrees/feature/my feature" },
    };
    const result = await intercept("ls", s);
    expect(result).toContain("'");
    expect(result).toContain("ls");
  });
});

// ── Rule 6: pass-through ──────────────────────────────────────────────────────

describe("Rule 6 — no worktree, no container — pass through", () => {
  it("returns the command unchanged", async () => {
    expect(await intercept("npm test", emptyState())).toBe("npm test");
    expect(await intercept("ls -la", emptyState())).toBe("ls -la");
    expect(await intercept("echo hello", emptyState())).toBe("echo hello");
  });
});

// ── shellQuote helper ─────────────────────────────────────────────────────────

describe("shellQuote — single-quote wrapping with internal quote escaping", () => {
  it("wraps path with spaces correctly in Rule 5 output", async () => {
    const s: WorktreesState = {
      worktree: { branch: "b", path: "/tmp/my path/here" },
    };
    const result = await intercept("ls", s);
    expect(result).toContain("cd '/tmp/my path/here'");
    expect(result).toContain("ls");
  });

  it("escapes single-quotes in paths", async () => {
    const s: WorktreesState = {
      worktree: { branch: "b", path: "/tmp/it's/here" },
    };
    const result = await intercept("ls", s);
    // Single quotes inside path should be escaped as '\''
    expect(result).toContain("'\\''");
  });
});

// ── cdSafe helper ─────────────────────────────────────────────────────────────

import { cdSafe, shellQuote } from "../src/bash-intercept.js";

describe("cdSafe — guarded cd with clear failure message", () => {
  it("includes the target path in the failure message", () => {
    const result = cdSafe("/some/path", "ls");
    expect(result).toContain("/some/path");
    expect(result).toContain("pi-worktrees: cannot cd to");
  });

  it("includes the original command after the guard", () => {
    const result = cdSafe("/some/path", "npm test");
    expect(result).toContain("npm test");
  });

  it("exits 1 on cd failure (not silently proceeds)", () => {
    const result = cdSafe("/no/such/dir", "echo hi");
    expect(result).toContain("exit 1");
    expect(result).toContain(">&2");
  });

  it("succeeds for an existing directory", async () => {
    const { execSync } = await import("node:child_process");
    const cmd = cdSafe("/tmp", "pwd");
    const out = execSync(`sh -c ${shellQuote(cmd)}`, { encoding: "utf8" });
    expect(out.trim()).toBe("/tmp");
  });

  it("fails with a clear message for a missing directory", async () => {
    const { execSync } = await import("node:child_process");
    const cmd = cdSafe("/nonexistent/path/xyz", "echo should-not-run");
    let stderr = "";
    try {
      execSync(`sh -c ${shellQuote(cmd)}`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e: unknown) {
      stderr = (e as { stderr: string }).stderr ?? "";
    }
    expect(stderr).toContain("pi-worktrees: cannot cd to");
    expect(stderr).toContain("/nonexistent/path/xyz");
  });
});

// ── Rule 4: container, no worktree — cds to containerWorkspace ────────────────

describe("Rule 4 — container, no worktree — always cds to containerWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startupOutcome.mockReturnValue({ outcome: null });
    probe.mockReturnValue(true);
    tail.mockReturnValue("");
  });

  it("cds to remoteWorkspaceFolder when set", async () => {
    const state: WorktreesState = {
      devcontainer: {
        enabled: true,
        workspace: ROOT,
        starting: false,
        remoteWorkspaceFolder: "/workspaces/myrepo",
      },
    };
    const result = await intercept("pwd", state);
    expect(result).toContain("/workspaces/myrepo");
    expect(result).toContain("pi-worktrees: cannot cd to");
    expect(result).toContain("pwd");
  });

  it("falls back to host workspace path when no remoteWorkspaceFolder", async () => {
    const state: WorktreesState = {
      devcontainer: { enabled: true, workspace: ROOT, starting: false },
    };
    const result = await intercept("pwd", state);
    expect(result).toContain(`/project`);
    expect(result).toContain("pwd");
  });

  it("reads remoteWorkspaceFolder from startup log when absent in state (race fix)", async () => {
    // Reproduces the session bug: state has no remoteWorkspaceFolder yet
    // (tool_call handler hasn't saved it) but the log has it.
    startupOutcome.mockReturnValue({
      outcome: "success",
      containerId: "abc123",
      remoteWorkspaceFolder: "/workspaces/myrepo",
    });
    const state: WorktreesState = {
      // remoteWorkspaceFolder intentionally absent — simulates the race
      devcontainer: { enabled: true, workspace: ROOT, starting: false },
    };
    const result = await intercept("uv lock --check", state);
    // Must use container-side path, not host path
    expect(result).toContain("/workspaces/myrepo");
    expect(result).not.toContain("cd '/project'");
    expect(result).toContain("uv lock --check");
  });
});

// ── Rule 4: --container-id vs --workspace-folder ─────────────────────────────────────────

describe("Rule 4 — exec routing: --container-id vs --workspace-folder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tail.mockReturnValue("");
  });

  it("uses --container-id when log has containerId (no --workspace-folder)", async () => {
    // Reproduces the session bug: container started with old config, reused
    // by devcontainer up; workspace-folder path doesn't exist in container.
    // Fix: use --container-id so no cwd/workspace-folder configuration is needed.
    startupOutcome.mockReturnValue({
      outcome: "success",
      containerId: "abc123def456",
      remoteWorkspaceFolder: "/workspaces/myrepo",
    });
    const state: WorktreesState = {
      devcontainer: { enabled: true, workspace: ROOT, starting: false },
    };
    const result = await intercept("npm test", state);
    expect(result).toContain("--container-id");
    expect(result).toContain("abc123def456");
    expect(result).not.toContain("--workspace-folder");
    expect(result).not.toContain("--override-config");
  });

  it("falls back to --workspace-folder when log has no containerId", async () => {
    startupOutcome.mockReturnValue({ outcome: null });
    probe.mockReturnValue(true);
    const state: WorktreesState = {
      devcontainer: { enabled: true, workspace: ROOT, starting: false },
    };
    const result = await intercept("npm test", state);
    expect(result).toContain("--workspace-folder");
    expect(result).toContain("--override-config");
    expect(result).not.toContain("--container-id");
  });

  it("uses container-side path for cd when containerId present (no OCI chdir failure)", async () => {
    // This is the specific failure from the session: container mounted at
    // /workspaces/myrepo but exec tried to cd to /project (host path).
    startupOutcome.mockReturnValue({
      outcome: "success",
      containerId: "deadbeef1234",
      remoteWorkspaceFolder: "/workspaces/myrepo",
    });
    const state: WorktreesState = {
      devcontainer: { enabled: true, workspace: ROOT, starting: false },
      // No remoteWorkspaceFolder in state \u2014 simulates the race
    };
    const result = await intercept("uv lock --check", state);
    // Container-side cd, not host path (path appears shell-quoted in the result)
    expect(result).toContain("/workspaces/myrepo");
    expect(result).not.toContain("/project");
  });

  it("worktree path mapped to container-side prefix when using --container-id", async () => {
    startupOutcome.mockReturnValue({
      outcome: "success",
      containerId: "deadbeef1234",
      remoteWorkspaceFolder: "/workspaces/myrepo",
    });
    const state: WorktreesState = {
      devcontainer: { enabled: true, workspace: ROOT, starting: false },
      worktree: { branch: "fix-agent-session", path: "/project/.pi/worktrees/fix-agent-session" },
    };
    const result = await intercept("uv lock --check", state);
    expect(result).toContain("--container-id");
    // Worktree path: /project/.pi/worktrees/fix-agent-session
    // Mapped:        /workspaces/myrepo/.pi/worktrees/fix-agent-session
    expect(result).toContain("/workspaces/myrepo/.pi/worktrees/fix-agent-session");
    expect(result).not.toContain("/project/");
  });
});

// ── Rule 4: display comment ──────────────────────────────────────────────────

describe("Rule 4 — display comment shows original command in TUI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tail.mockReturnValue("");
  });

  it("prepends # [container] <cmd> comment when using --container-id", async () => {
    startupOutcome.mockReturnValue({
      outcome: "success",
      containerId: "abc123",
      remoteWorkspaceFolder: "/workspaces/myrepo",
    });
    const state: WorktreesState = {
      devcontainer: { enabled: true, workspace: ROOT, starting: false },
    };
    const result = await intercept("uv lock --check", state);
    expect(result).toMatch(/^# \[container\] uv lock --check\n/);
  });

  it("prepends # [container] <cmd> comment when falling back to --workspace-folder", async () => {
    startupOutcome.mockReturnValue({ outcome: null });
    probe.mockReturnValue(true);
    const state: WorktreesState = {
      devcontainer: { enabled: true, workspace: ROOT, starting: false },
    };
    const result = await intercept("npm test", state);
    expect(result).toMatch(/^# \[container\] npm test\n/);
  });

  it("comment uses the ORIGINAL command, not the wrapped exec form", async () => {
    startupOutcome.mockReturnValue({
      outcome: "success",
      containerId: "abc123",
      remoteWorkspaceFolder: "/workspaces/myrepo",
    });
    const state: WorktreesState = {
      devcontainer: { enabled: true, workspace: ROOT, starting: false },
    };
    const result = await intercept("uv lock --check", state);
    // Comment shows original, rest shows devcontainer exec
    const lines = result.split("\n");
    expect(lines[0]).toBe("# [container] uv lock --check");
    expect(lines[1]).toContain("devcontainer exec");
  });
});

// ── Routing metadata ──────────────────────────────────────────────────────────

describe("InterceptResult routing metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tail.mockReturnValue("");
    startupOutcome.mockReturnValue({ outcome: null });
  });

  it("HOST: prefix → routing='host'", async () => {
    expect(await interceptRouting("HOST: npm install", emptyState())).toBe("host");
  });

  it("git command → routing='host'", async () => {
    expect(await interceptRouting("git status", emptyState())).toBe("host");
  });

  it("gh command → routing='host'", async () => {
    expect(await interceptRouting("gh pr list", emptyState())).toBe("host");
  });

  it("passthrough (no worktree, no container) → routing='host'", async () => {
    expect(await interceptRouting("ls", emptyState())).toBe("host");
  });

  it("worktree only (no container) → routing='host'", async () => {
    const state: WorktreesState = {
      worktree: { branch: "feat", path: "/project/.pi/worktrees/feat" },
    };
    expect(await interceptRouting("ls", state)).toBe("host");
  });

  it("container enabled not starting (alive) → routing='container'", async () => {
    startupOutcome.mockReturnValue({ outcome: "success", containerId: "abc" });
    const state: WorktreesState = {
      devcontainer: { enabled: true, workspace: ROOT, starting: false },
    };
    expect(await interceptRouting("npm test", state)).toBe("container");
  });

  it("container starting → routing='error'", async () => {
    tail.mockReturnValue("");
    const state: WorktreesState = {
      devcontainer: { enabled: true, workspace: ROOT, starting: true, startedAt: Date.now() },
    };
    expect(await interceptRouting("npm test", state)).toBe("error");
  });

  it("container enabled but dead → routing='error'", async () => {
    probe.mockReturnValue(false);
    const state: WorktreesState = {
      devcontainer: { enabled: true, workspace: ROOT, starting: false },
    };
    expect(await interceptRouting("npm test", state)).toBe("error");
  });
});
