## ADDED Requirements

### Requirement: `/worktree hooks` SHALL display post_create hooks
`/worktree hooks` (or `/worktree hooks show`) SHALL read `.wtp.yml` and display a
numbered list of all `post_create` hooks via `ctx.ui.notify`.

#### Scenario: Hooks present
- **WHEN** `.wtp.yml` exists and `hooks.post_create` contains one or more entries
- **THEN** `ctx.ui.notify` is called with a formatted numbered list including type and value for each hook
- **THEN** usage hints for `add` and `remove` are appended

#### Scenario: No `.wtp.yml`
- **WHEN** `.wtp.yml` does not exist at the project root
- **THEN** `ctx.ui.notify` is called with a message indicating no config was found and how to create one

#### Scenario: Empty hooks
- **WHEN** `.wtp.yml` exists but `hooks.post_create` is absent or empty
- **THEN** `ctx.ui.notify` is called with a message indicating no hooks are defined

---

### Requirement: `/worktree hooks add` SHALL append a command hook
`/worktree hooks add <command>` SHALL append a `{ type: "command", command: <value> }`
entry to `hooks.post_create` in `.wtp.yml`, creating the file if absent.

#### Scenario: Normal add to existing config
- **WHEN** `/worktree hooks add npm install` is called and `.wtp.yml` exists
- **THEN** `hooks.post_create` gains a new `{ type: "command", command: "npm install" }` entry
- **THEN** `ctx.ui.notify` confirms the addition with the new hook index

#### Scenario: Add creates `.wtp.yml` when absent
- **WHEN** `/worktree hooks add mise install` is called and no `.wtp.yml` exists
- **THEN** `.wtp.yml` is created with `defaults.base_dir: ".pi/worktrees"` and the new hook
- **THEN** `ctx.ui.notify` confirms the addition

#### Scenario: No argument
- **WHEN** `/worktree hooks add` is called with no argument
- **THEN** `ctx.ui.notify` shows a usage hint at `"info"` severity

---

### Requirement: `/worktree hooks remove` SHALL remove a hook by index
`/worktree hooks remove <n>` SHALL remove the hook at 1-based position `n` from
`hooks.post_create` after a `ctx.ui.confirm` prompt.

#### Scenario: Valid index, user confirms
- **WHEN** `/worktree hooks remove 2` is run and the user confirms the prompt
- **THEN** the hook at index 2 is removed from `.wtp.yml`
- **THEN** `ctx.ui.notify` confirms the removal

#### Scenario: Valid index, user cancels
- **WHEN** the user declines the confirm dialog
- **THEN** `.wtp.yml` is unchanged and `ctx.ui.notify` shows "Cancelled"

#### Scenario: Invalid or out-of-range index
- **WHEN** the index is not a number or exceeds the hook count
- **THEN** `ctx.ui.notify` shows an error at `"warning"` severity without modifying the file

---

### Requirement: `/worktree hooks clear` SHALL remove all hooks
`/worktree hooks clear` SHALL remove all entries from `hooks.post_create` after a
`ctx.ui.confirm` prompt.

#### Scenario: Hooks present, user confirms
- **WHEN** the user confirms the clear prompt
- **THEN** `hooks.post_create` is set to `[]` and `.wtp.yml` is written back
- **THEN** `ctx.ui.notify` confirms all hooks were cleared

#### Scenario: User cancels
- **WHEN** the user declines the confirm dialog
- **THEN** `.wtp.yml` is unchanged and `ctx.ui.notify` shows "Cancelled"

#### Scenario: No hooks to clear
- **WHEN** `hooks.post_create` is absent or empty
- **THEN** `ctx.ui.notify` informs the user there is nothing to clear

---

### Requirement: `/worktree init` SHALL interactively configure `.wtp.yml`
`/worktree init` SHALL run a guided sequence using `ctx.ui.input` and `ctx.ui.confirm`
to collect setup commands and copy-files, then write `.wtp.yml` with the result.

#### Scenario: Full init with commands and files
- **WHEN** the user enters `"npm install, mise install"` for commands and `".env"` for files
- **THEN** `.wtp.yml` is written with three `post_create` hooks: two command hooks and one copy hook
- **THEN** `ctx.ui.notify` confirms the number of hooks written

#### Scenario: Blank inputs fall back to default template
- **WHEN** the user leaves both inputs blank
- **THEN** `.wtp.yml` is written with the built-in default hooks (copy secrets + direnv allow)
- **THEN** `ctx.ui.notify` confirms the default template was written

#### Scenario: File exists, user declines overwrite
- **WHEN** `.wtp.yml` already exists and the user declines the overwrite confirm
- **THEN** the file is unchanged and `ctx.ui.notify` shows "Cancelled"
