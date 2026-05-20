## Context

This is the pi-dev-worktrees side of the bash-dispatch-chips change. The companion design and approach comparison live in the pi-agent-dashboard repo at `openspec/changes/bash-dispatch-chips/design.md`.

### Decided approach: Path B (prompt_request, immediate in-flight feedback)

Emit a `bash-dispatch` `prompt_request` from the `tool_call` handler — immediately after routing, before the command executes. The dashboard's suppression mechanism hides the bare bash card; the `BashDispatchRenderer` (registered by `pi-dev-worktrees-plugin`) renders chips for routing and RTK rewrites while the command is in flight. Auto-dismissed when the tool result arrives.

### What this extension can observe

**In `tool_execution_start`** (fires first, before any extension mutation):
- `event.args.command` = original LLM command (pre-RTK)
- `event.toolCallId`

**In `tool_call`** (after RTK has run, before routing):
- `event.input.command` = post-RTK command
- `event.toolCallId`

After `applyBashIntercept` completes:
- `result.command` = final routed command
- `result.routing` = `"host" | "container" | "error"`

### Event ordering (confirmed)

```
tool_execution_start  ← original LLM args, no mutation yet
tool_call             ← RTK mutates first, then this handler; sees post-RTK command
(tool executes)
tool_result           ← RTK compacts first, then this handler
```

### Module-level state additions

```ts
// Keyed by toolCallId; deleted after consuming in tool_call
const pendingLlmCommands = new Map<string, string>();
```

The existing `lastBashRouting: BashRouting | null` pattern works for `tool_result` because calls are serial. For `tool_execution_start` → `tool_call` pairing, a Map keyed by `toolCallId` is cleaner and safe for any future parallelism.

### ctx.ui.notify opts extension (dashboard bridge prerequisite)

The companion bridge change (`pi-agent-dashboard/openspec/changes/bash-dispatch-chips/specs/01-bridge-notify-opts.md`) extends `ctx.ui.notify` to accept:

```ts
ctx.ui.notify(message, {
  toolCallId?: string,
  level?: string,
  method?: string,    // sets prompt.type + component.type; drives renderer lookup
  props?: Record<string, unknown>,  // merged into component.props
})
```

This extension is backward-compatible. Pi-dev-worktrees uses it to emit the structured payload without modifying the bridge for each new use case.

### devcontainer check

`hasDevcontainer` in the payload tells the renderer whether to show the `host` chip. Only meaningful when a devcontainer is configured. Read from `state.devcontainer?.enabled !== undefined` (i.e. devcontainer config exists in session, regardless of whether it's currently running).
