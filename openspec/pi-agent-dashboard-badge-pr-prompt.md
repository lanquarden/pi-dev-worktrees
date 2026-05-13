# Add pi-worktrees session-card-badge plugin

## Context

`pi-worktrees` is a pi coding-agent extension that manages git worktrees and devcontainer targeting per session. It already emits runtime `ext_ui_decorator` messages that populate the session content header with a `footer-segment` chip showing the active worktree branch and container state (`⎇ feature/auth`, `🐳 on`, etc.).

The data is already flowing into `session.uiDecorators` on every session that has pi-worktrees active. What's missing is a React plugin that reads this data and renders it in the **sidebar session card** (the WORKSPACE subcard, same row as `gitBranch` and the jj workspace badge).

## Goal

Add a new plugin package `packages/pi-worktrees-plugin/` that contributes a `session-card-badge` React component. The badge reads from `session.uiDecorators` (already populated by the pi-worktrees extension's `ext_ui_decorator` messages) and renders a compact chip in the sidebar WORKSPACE subcard.

## Reference: how to read the data

The pi-worktrees extension emits a `footer-segment` decorator with:
- `namespace: "pi-worktrees"`
- `id: "workspace-state"`
- `payload.text`: e.g. `"⎇ feature/auth"`, `"🐳 on"`, `"⎇ fix/bug  🐳 starting…"`, or empty/absent when both are off

The key in `session.uiDecorators` is `"footer-segment:pi-worktrees:workspace-state"`.

```typescript
const decorator = session.uiDecorators?.["footer-segment:pi-worktrees:workspace-state"];
const text = decorator?.payload?.text; // string | undefined
```

When the worktree and devcontainer are both off, the `ext_ui_decorator` message is sent with `removed: true` — the key is deleted from `uiDecorators`. So `text` is either a non-empty string or undefined.

## Reference: pattern to follow

The jj workspace badge is the closest analogy. Study these files:
- `packages/pi-dashboard-jj-plugin/src/client/JjWorkspaceBadge.tsx` — badge component
- `packages/pi-dashboard-jj-plugin/package.json` — manifest structure (`pi-dashboard-plugin` field)
- The manifest declares: `slot: "session-card-badge"`, `component: "JjWorkspaceBadge"`, `predicate: "isInJjWorkspace"`, `shouldRender: "isInJjWorkspace"`

## What to build

### 1. `packages/pi-worktrees-plugin/package.json`

Declare the `pi-dashboard-plugin` manifest:
- `id: "pi-worktrees"`
- `displayName: "pi-worktrees Workspace"`
- `priority: 100`
- `client: "./src/client/index.tsx"`
- One claim: `slot: "session-card-badge"`, `component: "PiWorktreesBadge"`, `shouldRender: "hasPiWorktrees"`

### 2. `packages/pi-worktrees-plugin/src/client/index.tsx`

Export two things:

**`hasPiWorktrees(session)`** — predicate/shouldRender:
```typescript
export function hasPiWorktrees(session: DashboardSession | null | undefined): boolean {
  const text = session?.uiDecorators?.["footer-segment:pi-worktrees:workspace-state"]?.payload?.text;
  return typeof text === "string" && text.length > 0;
}
```

**`PiWorktreesBadge({ session })`** — the badge component:
- Reads `session.uiDecorators["footer-segment:pi-worktrees:workspace-state"]?.payload.text`
- Returns `null` if absent/empty (shouldRender guards this but be defensive)
- Renders a compact chip styled like `JjWorkspaceBadge` (same `px-1.5 py-[1px] rounded font-mono text-[10px]` pattern)
- Color palette: use green tones to distinguish from jj's indigo — e.g. `rgba(34, 197, 94, 0.15)` bg with `rgb(21, 128, 61)` text (light) / `rgb(134, 239, 172)` text (dark) — or pick whatever fits the dashboard palette
- No icon needed (the text already contains emoji: `⎇`, `🐳`)
- `data-testid="pi-worktrees-badge"`
- `title={text}` for tooltip

### 3. Tests

Add a test file `packages/pi-worktrees-plugin/src/client/__tests__/PiWorktreesBadge.test.tsx`:
- `hasPiWorktrees` returns false for null/undefined session
- `hasPiWorktrees` returns false when uiDecorators is absent
- `hasPiWorktrees` returns false when the key is absent
- `hasPiWorktrees` returns true when text is a non-empty string
- Badge renders null when `hasPiWorktrees` is false
- Badge renders the text when active
- Badge has correct `data-testid`

## Constraints

- No new dependencies beyond what's already in the monorepo
- Follow the exact same package structure as `packages/pi-dashboard-jj-plugin/`
- The component must be purely reactive to `session.uiDecorators` — no server entry, no bridge entry, no config schema needed
- Do NOT modify any existing files outside `packages/pi-worktrees-plugin/`

## Acceptance criteria

1. `packages/pi-worktrees-plugin/` scaffolded with `package.json`, `src/client/index.tsx`, and tests
2. When a pi session has pi-worktrees active with a worktree branch set, the sidebar session card shows the badge in the WORKSPACE subcard
3. When both worktree and devcontainer are off, the badge is absent (WORKSPACE subcard hides if no other contributions)
4. Tests pass: `npm test -w packages/pi-worktrees-plugin`
5. TypeScript compiles without errors
