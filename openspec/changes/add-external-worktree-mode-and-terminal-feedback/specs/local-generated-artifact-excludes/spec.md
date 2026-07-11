# local-generated-artifact-excludes Specification

## Purpose

Keep extension-generated machine/session artifacts out of Git status without modifying the repository's shared `.gitignore` policy.

## ADDED Requirements

### Requirement: The extension SHALL use Git's resolved local exclude file

When excluding a generated artifact, the extension SHALL resolve the local exclude path by running `git rev-parse --git-path info/exclude` from the relevant Git worktree root. It SHALL NOT assume that `<workspace>/.git` is a directory.

#### Scenario: Normal repository
- **GIVEN** Git resolves `info/exclude` to `.git/info/exclude`
- **WHEN** a generated artifact is excluded
- **THEN** the resolved path under the repository Git directory is updated

#### Scenario: Linked worktree
- **GIVEN** the workspace `.git` is a file pointing at linked-worktree metadata
- **WHEN** Git resolves `info/exclude` to the repository's applicable exclude file
- **THEN** that resolved file is updated
- **AND** the extension does not attempt to write `<workspace>/.git/info/exclude` directly

#### Scenario: External Git directory
- **GIVEN** the repository uses an external Git directory
- **WHEN** Git returns an absolute exclude path
- **THEN** the absolute path is used as returned

---

### Requirement: Every in-repository generated artifact SHALL be excluded locally

Every extension code path that creates a file or directory inside a Git worktree/repository SHALL pass its absolute path to the local-exclude helper. The helper SHALL convert it to a slash-normalized, anchored Git exclude pattern. Repeated attempts to exclude the same normalized pattern SHALL leave exactly one equivalent entry. This invariant SHALL apply to future generated artifacts without requiring a separate fixed startup list.

#### Scenario: Root-level generated wtp config
- **GIVEN** the extension generates `<gitRoot>/.wtp.yml`
- **WHEN** it records the exclusion
- **THEN** the exclude file contains `/.wtp.yml`

#### Scenario: Devcontainer artifacts at workspace root
- **GIVEN** devcontainer root equals Git root
- **WHEN** override and startup log artifacts are initialized
- **THEN** the exclude file contains `/.pi/devcontainer.override.json`
- **AND** it contains `/.pi/devcontainer-up.log`

#### Scenario: Nested session cwd
- **GIVEN** external mode uses `<gitRoot>/packages/api` as `sessionCwd`
- **WHEN** devcontainer artifacts are generated there
- **THEN** patterns are `/packages/api/.pi/devcontainer.override.json` and `/packages/api/.pi/devcontainer-up.log`

#### Scenario: Duplicate generation
- **GIVEN** an artifact pattern already exists in the exclude file
- **WHEN** generation or startup runs again
- **THEN** the pattern is not appended a second time

#### Scenario: Future generated artifact
- **GIVEN** a later version adds a new generated file inside the repository
- **WHEN** that generation path is implemented
- **THEN** it uses the same local-exclude helper
- **AND** it does not update `.gitignore`

---

### Requirement: In-repository generated worktree roots SHALL be excluded locally

When this extension creates or targets a managed worktree root inside the Git worktree root, it SHALL add an anchored directory pattern for that root. It SHALL NOT add a pattern for worktree roots outside the repository.

#### Scenario: Default worktree root
- **GIVEN** managed worktrees use `<gitRoot>/.pi/worktrees`
- **WHEN** the extension initializes or creates a managed worktree there
- **THEN** the exclude file contains `/.pi/worktrees/`

#### Scenario: Custom in-repository root
- **GIVEN** resolved worktree root is `<gitRoot>/.local-worktrees`
- **WHEN** the extension creates a worktree there
- **THEN** the exclude file contains `/.local-worktrees/`

#### Scenario: Absolute external root
- **GIVEN** resolved worktree root is `/fast-ssd/worktrees`, outside `gitRoot`
- **WHEN** the extension creates a worktree there
- **THEN** no Git exclude pattern is added for that directory

---

### Requirement: The extension SHALL NOT mutate .gitignore for any generated artifact

No extension-generated file or directory path SHALL be appended to, removed from, or rewritten in `.gitignore`. Existing `.gitignore` entries from users or older extension versions SHALL remain untouched.

#### Scenario: Override generation
- **GIVEN** `.gitignore` does not mention the devcontainer override
- **WHEN** `generateOverrideJson` creates the override
- **THEN** `.gitignore` remains byte-for-byte unchanged
- **AND** the local exclude file receives the generated path instead

#### Scenario: Existing legacy ignore line
- **GIVEN** `.gitignore` already contains `.pi/devcontainer.override.json`
- **WHEN** the extension starts after upgrade
- **THEN** that line is not removed or modified

#### Scenario: Generated file is already tracked
- **GIVEN** a generated-path file is already tracked by Git
- **WHEN** its path is added to `info/exclude`
- **THEN** tracking behavior is unchanged
- **AND** the extension does not attempt to untrack it

---

### Requirement: Local exclusion SHALL be best-effort outside Git repositories

Failure to resolve or write the local Git exclude file SHALL NOT prevent devcontainer operation or artifact generation. The extension SHALL not fall back to `.gitignore` mutation.

#### Scenario: External-mode non-Git devcontainer
- **GIVEN** external worktree mode in a non-Git `sessionCwd`
- **AND** a valid devcontainer config exists there
- **WHEN** override/log artifacts are generated
- **THEN** devcontainer operation continues
- **AND** no `.gitignore` is created or modified

#### Scenario: Exclude file cannot be written
- **GIVEN** Git resolves an exclude path but the path is not writable
- **WHEN** the extension attempts to record a generated artifact
- **THEN** artifact generation and the requested operation continue
- **AND** no repository file is used as a fallback ignore target
