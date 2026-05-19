# npm-packaging Specification

## Purpose

Both packages in the monorepo SHALL be publishable to npm under the `@lanquarden` scope.
`@lanquarden/pi-dev-worktrees` SHALL be discoverable and auto-installable by the pi
package system. `@lanquarden/pi-dev-worktrees-dashboard-plugin` SHALL be discoverable
via the npm registry as a pi-agent-dashboard plugin.
## Requirements
### Requirement: `@lanquarden/pi-dev-worktrees` SHALL declare a `pi` manifest
`packages/pi-dev-worktrees/package.json` SHALL contain a `"pi"` key with an
`"extensions"` array listing `"./src/index.ts"` as the extension entry point. This
enables `pi install npm:@lanquarden/pi-dev-worktrees` to discover and register the
extension automatically.

#### Scenario: pi install discovers the extension
- **GIVEN** `package.json` contains `"pi": { "extensions": ["./src/index.ts"] }`
- **WHEN** the user runs `pi install npm:@lanquarden/pi-dev-worktrees`
- **THEN** pi loads `src/index.ts` as an extension without requiring manual `settings.json` edits

---

### Requirement: `@lanquarden/pi-dev-worktrees` SHALL have all required npm publishable fields
`packages/pi-dev-worktrees/package.json` SHALL contain: `name` (`@lanquarden/pi-dev-worktrees`),
`version`, `description`, `license`, `publishConfig` (`access: "public"`), `keywords`
(including `"pi-package"`), `repository`, `exports` (pointing at `./src/index.ts`),
and `files` (`["src/"]`).

#### Scenario: package fields are complete
- **GIVEN** the package.json as written
- **THEN** `npm pack` produces a tarball containing only the `src/` directory
- **THEN** the package is discoverable in the pi gallery via the `pi-package` keyword

---

### Requirement: pi runtime dependencies SHALL remain as `peerDependencies`
`@earendil-works/pi-coding-agent` and `typebox` SHALL be listed in `peerDependencies`
with `"*"` range and SHALL NOT appear in `dependencies` or `bundledDependencies`.

#### Scenario: peerDeps not bundled
- **GIVEN** `peerDependencies` contains `@earendil-works/pi-coding-agent` and `typebox`
- **THEN** they are NOT included in the published tarball
- **THEN** pi provides them at runtime from its own installation

---

### Requirement: `@lanquarden/pi-dev-worktrees-dashboard-plugin` SHALL include discovery keywords
`packages/pi-dev-worktrees-dashboard-plugin/package.json` SHALL contain a `"keywords"`
array including `"pi-dashboard-plugin"` and `"pi-dev-worktrees"`.

#### Scenario: dashboard plugin is discoverable
- **GIVEN** keywords include `"pi-dashboard-plugin"`
- **THEN** the package appears in npm searches for pi dashboard plugins

---

### Requirement: the `pi` key SHALL NOT be added to the dashboard plugin
`packages/pi-dev-worktrees-dashboard-plugin/package.json` SHALL NOT contain a `"pi"`
key. The dashboard plugin is identified by the existing `"pi-dashboard-plugin"` key
and is not a pi extension.

#### Scenario: dashboard plugin package.json has no pi key
- **GIVEN** the dashboard plugin package.json
- **THEN** it contains `"pi-dashboard-plugin"` but NOT `"pi"`

---

### Requirement: both packages SHALL be scoped under `@lanquarden/`
Package names SHALL be `@lanquarden/pi-dev-worktrees` and
`@lanquarden/pi-dev-worktrees-dashboard-plugin` respectively.

#### Scenario: scoped names
- **THEN** `packages/pi-dev-worktrees/package.json` `"name"` === `"@lanquarden/pi-dev-worktrees"`
- **THEN** `packages/pi-dev-worktrees-dashboard-plugin/package.json` `"name"` === `"@lanquarden/pi-dev-worktrees-dashboard-plugin"`

