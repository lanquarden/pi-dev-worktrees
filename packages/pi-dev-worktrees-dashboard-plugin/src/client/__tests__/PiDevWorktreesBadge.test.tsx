import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { hasPiDevWorktrees } from "../predicates.js";
import { PiDevWorktreesBadge } from "../PiDevWorktreesBadge.js";

function makeSession(text?: string): any {
  if (text === undefined) {
    return { uiDecorators: {} };
  }
  return {
    uiDecorators: {
      "footer-segment:pi-dev-worktrees:workspace-state": {
        kind: "footer-segment",
        namespace: "pi-dev-worktrees",
        id: "workspace-state",
        payload: { text },
      },
    },
  };
}

describe("hasPiDevWorktrees", () => {
  it("returns false for null", () => {
    expect(hasPiDevWorktrees(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(hasPiDevWorktrees(undefined)).toBe(false);
  });

  it("returns false when uiDecorators is absent", () => {
    expect(hasPiDevWorktrees({} as any)).toBe(false);
  });

  it("returns false when key is absent", () => {
    expect(hasPiDevWorktrees(makeSession())).toBe(false);
  });

  it("returns false when text is empty string", () => {
    expect(hasPiDevWorktrees(makeSession(""))).toBe(false);
  });

  it("returns true when text is a non-empty string", () => {
    expect(hasPiDevWorktrees(makeSession("⎇ feature/auth"))).toBe(true);
  });

  it("returns true for plain text workspace name", () => {
    expect(hasPiDevWorktrees(makeSession("🐳 devcontainer"))).toBe(true);
  });
});

describe("PiDevWorktreesBadge", () => {
  it("renders null when uiDecorators key is absent", () => {
    const { container } = render(
      <PiDevWorktreesBadge session={makeSession()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders null when text is empty", () => {
    const { container } = render(
      <PiDevWorktreesBadge session={makeSession("")} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the text when present", () => {
    const { getByTestId } = render(
      <PiDevWorktreesBadge session={makeSession("⎇ feature/auth")} />,
    );
    const badge = getByTestId("pi-dev-worktrees-badge");
    expect(badge.textContent).toBe("⎇ feature/auth");
  });

  it("has data-testid='pi-dev-worktrees-badge'", () => {
    const { container } = render(
      <PiDevWorktreesBadge session={makeSession("main")} />,
    );
    expect(container.querySelector('[data-testid="pi-dev-worktrees-badge"]')).toBeTruthy();
  });

  it("has correct title attribute", () => {
    const { container } = render(
      <PiDevWorktreesBadge session={makeSession("⎇ feature/auth")} />,
    );
    expect(
      container.querySelector('[data-testid="pi-dev-worktrees-badge"]')?.getAttribute("title"),
    ).toBe("⎇ feature/auth");
  });
});
