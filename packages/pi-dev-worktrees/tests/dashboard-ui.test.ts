import { beforeEach, describe, expect, it, vi } from "vitest";
import { state } from "../src/session.js";
import { registerDashboardUi } from "../src/dashboard-ui.js";

function mockPi() {
  const handlers = new Map<string, (data: any) => void>();
  return {
    events: {
      on: vi.fn((name: string, handler: (data: any) => void) => handlers.set(name, handler)),
      emit: vi.fn(),
    },
    handlers,
  };
}

beforeEach(() => {
  state.worktree = undefined;
  state.devcontainer = undefined;
});

describe("dashboard capability contributions", () => {
  it("omits worktree management in external mode while preserving devcontainer feedback", () => {
    state.devcontainer = { enabled: true, workspace: "/repo", starting: false };
    const pi = mockPi();
    registerDashboardUi(pi as any, false);
    const probe = { modules: [] as any[] };
    pi.handlers.get("ui:list-modules")!(probe);
    expect(probe.modules.some((module) => module.kind === "management-modal")).toBe(false);
    expect(probe.modules).toContainEqual(expect.objectContaining({
      kind: "footer-segment",
      payload: expect.objectContaining({ text: expect.stringContaining("🐳 on") }),
    }));
  });

  it("ignores defensive dashboard delete actions in external mode", () => {
    const pi = mockPi();
    registerDashboardUi(pi as any, false);
    expect(() => pi.handlers.get("workspaces:delete-row")!({ branch: "feature/x" })).not.toThrow();
    expect(pi.events.emit).not.toHaveBeenCalledWith("pi-dev-worktrees:workspace-removed", expect.anything());
  });
});
