/**
 * Tests for bash-intercept.ts decision table and devcontainer diagnostics.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock devcontainer module so probeContainer / tailContainerLog / readStartupOutcome are controllable
vi.mock("./devcontainer.js", () => ({
  probeContainer: vi.fn(),
  tailContainerLog: vi.fn(),
  readStartupOutcome: vi.fn(),
}));

import { probeContainer, tailContainerLog, readStartupOutcome } from "./devcontainer.js";
import { applyBashIntercept } from "./bash-intercept.js";
import type { WorktreesState } from "./session.js";

const probe = probeContainer as ReturnType<typeof vi.fn>;
const tail = tailContainerLog as ReturnType<typeof vi.fn>;
const startupOutcome = readStartupOutcome as ReturnType<typeof vi.fn>;

const ROOT = "/project";

function emptyState(): WorktreesState {
  return {};
}

// ── Helper ───────────────────────────────────────────────────────────────────

async function intercept(cmd: string, state: WorktreesState): Promise<string> {
  return applyBashIntercept(cmd, state, ROOT);
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

  it("probes container before wrapping", async () => {
    probe.mockReturnValue(true);
    await intercept("npm test", runningState);
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

  it("wraps with cd to worktree when both active", async () => {
    probe.mockReturnValue(true);
    const state: WorktreesState = {
      devcontainer: { enabled: true, workspace: ROOT, starting: false },
      worktree: { branch: "feature/auth", path: "/project/.pi/worktrees/feature/auth" },
    };
    const result = await intercept("npm test", state);
    expect(result).toContain("devcontainer exec");
    // Inside the sh -c '...' wrapper, single quotes are escaped as '\''
    expect(result).toContain("/project/.pi/worktrees/feature/auth");
    expect(result).toContain("npm test");
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

  it("prepends cd to the worktree path", async () => {
    const result = await intercept("npm test", worktreeState);
    expect(result).toBe("cd '/project/.pi/worktrees/feature/foo' && npm test");
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
  // Access via re-export or inline test on the wrapped output
  it("wraps path with spaces correctly in Rule 5 output", async () => {
    const s: WorktreesState = {
      worktree: { branch: "b", path: "/tmp/my path/here" },
    };
    const result = await intercept("ls", s);
    // Should be: cd '/tmp/my path/here' && ls
    expect(result).toBe("cd '/tmp/my path/here' && ls");
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
