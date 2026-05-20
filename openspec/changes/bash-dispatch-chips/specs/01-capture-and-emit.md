# Spec: Capture LLM command and emit bash-dispatch

## File
`packages/pi-dev-worktrees/src/index.ts`

## New module-level state

```ts
// Keyed by toolCallId. Stores original LLM command (pre-RTK) captured in
// tool_execution_start. Deleted after consuming in tool_call.
const pendingLlmCommands = new Map<string, string>();
```

## New: tool_execution_start handler

```ts
pi.on("tool_execution_start", (event) => {
  if (event.toolName !== "bash") return;
  if (event.toolCallId) {
    pendingLlmCommands.set(event.toolCallId, (event.args as { command?: string })?.command ?? "");
  }
});
```

Register this handler alongside the existing `tool_call` handler.

## Modified: tool_call handler

At the top of the bash `tool_call` handler, after the devcontainer-starting block and before `applyBashIntercept`:

```ts
// Capture post-RTK command (RTK already ran before this handler)
const rtkCommand = (event.input as { command: string }).command;

// Retrieve original LLM command captured in tool_execution_start
const llmCommand = pendingLlmCommands.get(event.toolCallId ?? "") ?? rtkCommand;
pendingLlmCommands.delete(event.toolCallId ?? "");

const rtkRewritten = rtkCommand !== llmCommand;
```

After `applyBashIntercept` (where `result.routing` and `result.command` are available):

```ts
// Emit in-flight bash-dispatch card to dashboard (no-op when no bridge connected)
(ctx.ui as any).notify?.(llmCommand, {
  toolCallId: event.toolCallId,
  method: "bash-dispatch",
  props: {
    llmCommand,
    rtkRewritten,
    rtkCommand: rtkRewritten ? rtkCommand : undefined,
    routing: result.routing,
    hasDevcontainer: state.devcontainer !== undefined,
  } satisfies BashDispatchProps,
});
```

Cast to `any` because `ctx.ui.notify`'s TypeScript signature in the pi ExtensionAPI types does not yet reflect the bridge opts extension. At runtime the bridge patches the method with the extended signature.

## BashDispatchProps type (local, not shared)

```ts
// Defined inline in index.ts or imported from a local types file.
// Mirrors BashDispatchProps in packages/pi-dev-worktrees-plugin.
interface BashDispatchProps {
  llmCommand: string;
  rtkRewritten: boolean;
  rtkCommand?: string;
  routing: "host" | "container" | "error";
  hasDevcontainer: boolean;
}
```

No cross-repo shared type — each side defines its own interface and they are kept in sync by convention.

## No tool_result changes

The dashboard's suppression mechanism (`findActiveInteractiveToolResultIds`) auto-resolves the `interactiveUi` row when the tool status flips to complete. No explicit dismiss call needed from this side.

## No-bridge safety

`ctx.ui.notify` exists in both TUI and dashboard contexts. In TUI context the bridge does not patch it with the opts extension, so the opts object is ignored — the original notify runs with just `(message, level)` where level is undefined (harmless). In dashboard context the bridge patch accepts and forwards the opts.

## Tests: `tests/bash-dispatch-emit.test.ts`

Test setup: mock `ctx.ui` with a `notify` spy. Exercise the `tool_call` handler directly with a pre-populated `pendingLlmCommands` entry.

### Cases to cover

| Scenario | llmCommand | rtkCommand | routing | Expected props |
|---|---|---|---|---|
| RTK rewrite + container | `grep foo` | `rtk grep foo` | `container` | rtkRewritten=true, rtkCommand set |
| RTK rewrite + host | `grep foo` | `rtk grep foo` | `host` | rtkRewritten=true, rtkCommand set |
| No RTK + container | `ls -la` | `ls -la` | `container` | rtkRewritten=false, rtkCommand undefined |
| No RTK + host | `ls -la` | `ls -la` | `host` | rtkRewritten=false |
| HOST: prefix | `HOST:ls` | `HOST:ls` | `host` | rtkRewritten=false, routing=host |
| Error routing | `ls` | `ls` | `error` | routing=error |

### Invariants
- `notify` called with `method: "bash-dispatch"` and `toolCallId` matching `event.toolCallId`
- `pendingLlmCommands` empty after handler returns
- `notify` NOT called for non-bash tool names
- `notify` NOT called when `event.toolCallId` is absent (defensive)
