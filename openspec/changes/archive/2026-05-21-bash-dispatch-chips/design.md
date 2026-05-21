## Context

### Decided approach: pi.events.emit (event_forward)

Emit a structured pi event from the `tool_call` handler immediately after routing. The bridge forwards it automatically as `event_forward`. The dashboard client reducer patches the tool row and the plugin renderer shows chips.

No `ctx.ui.notify`, no `prompt_request`, no bridge changes needed.

### What this extension observes

**In `tool_execution_start`** (fires first, before any extension mutation):
- `event.args.command` = original LLM command (pre-RTK)
- `event.toolCallId`

**In `tool_call`** (after RTK has run):
- `event.input.command` = post-RTK command
- `event.toolCallId`

After `applyBashIntercept`:
- `result.command` = final routed command
- `result.routing` = `"host" | "container" | "error"`

### Event ordering (confirmed)

```
tool_execution_start  ← original LLM args, no mutation yet
tool_call             ← RTK mutates first, then this handler; sees post-RTK command
(tool executes)
tool_result           ← RTK compacts first, then this handler
```

### Module-level state

```ts
// Keyed by toolCallId. Stores original LLM command (pre-RTK).
// Deleted after consuming in tool_call.
const pendingLlmCommands = new Map<string, string>();
```

### Emit call

```ts
pi.events.emit("pi-dev-worktrees:bash-dispatch", {
  toolCallId: event.toolCallId,
  llmCommand,
  rtkRewritten,
  rtkCommand: rtkRewritten ? rtkCommand : undefined,
  routing: result.routing,
  hasDevcontainer: state.devcontainer !== undefined,
});
```

Bridge's existing flow-event wiring picks this up and forwards as `event_forward` to the server, which relays to subscribed browsers. Zero bridge code changes.

### devcontainer check

`hasDevcontainer` tells the renderer whether to show the `host` chip. Read from `state.devcontainer !== undefined`.
