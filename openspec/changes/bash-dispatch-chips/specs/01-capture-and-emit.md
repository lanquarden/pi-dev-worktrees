# Spec: Capture LLM command and emit bash-dispatch event

## File
`packages/pi-dev-worktrees/src/index.ts`

## New module-level state

```ts
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

## Modified: tool_call handler

At handler entry, after devcontainer-starting block, before `applyBashIntercept`:

```ts
const rtkCommand = (event.input as { command: string }).command;
const llmCommand = pendingLlmCommands.get(event.toolCallId ?? "") ?? rtkCommand;
pendingLlmCommands.delete(event.toolCallId ?? "");
const rtkRewritten = rtkCommand !== llmCommand;
```

After `applyBashIntercept` (where `result.routing` is available):

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

## Payload type (local, not shared)

```ts
interface BashDispatchPayload {
  toolCallId: string;
  llmCommand: string;
  rtkRewritten: boolean;
  rtkCommand?: string;
  routing: "host" | "container" | "error";
  hasDevcontainer: boolean;
}
```

## Why pi.events.emit

Bridge's flow-event wiring forwards all `pi.events.emit` calls as `event_forward` messages to the server → browser. Zero bridge changes needed. In TUI context (no bridge), the event is silently ignored.

## Tests: `tests/bash-dispatch-emit.test.ts`

Mock `pi.events.emit`. Exercise `tool_call` handler with pre-populated `pendingLlmCommands`.

| Scenario | llmCommand | rtkCommand | routing | Expected |
|---|---|---|---|---|
| RTK + container | `grep foo` | `rtk grep foo` | `container` | rtkRewritten=true, rtkCommand set |
| RTK + host | `grep foo` | `rtk grep foo` | `host` | rtkRewritten=true, rtkCommand set |
| No RTK + container | `ls -la` | `ls -la` | `container` | rtkRewritten=false, no rtkCommand |
| No RTK + host | `ls -la` | `ls -la` | `host` | rtkRewritten=false |
| HOST: prefix | `HOST:ls` | `HOST:ls` | `host` | rtkRewritten=false |
| Error | `ls` | `ls` | `error` | routing=error |

### Invariants
- Event name always `"pi-dev-worktrees:bash-dispatch"`
- `toolCallId` matches `event.toolCallId`
- `pendingLlmCommands` empty after handler returns
- Emit NOT called for non-bash tools
