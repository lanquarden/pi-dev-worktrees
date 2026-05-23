# npm-release Specification

## Purpose

The repository SHALL have a manually-triggered release workflow that bumps package
versions, creates git tags, and publishes packages to the npm registry under the
`@lanquarden` scope with public access.
## Requirements
### Requirement: Release workflow SHALL be manually triggered with package and version inputs

A GitHub Actions workflow at `.github/workflows/release.yml` SHALL use
`workflow_dispatch` with three inputs:
- `package` (choice: `pi-dev-worktrees`, `pi-dev-worktrees-dashboard-plugin`, `both`)
- `version_bump` (choice: `patch`, `minor`, `major`)
- `dry_run` (boolean, default `false`)

#### Scenario: release a single package
- **GIVEN** the maintainer triggers the workflow
- **AND** selects `package: pi-dev-worktrees`
- **AND** selects `version_bump: patch`
- **WHEN** the workflow runs
- **THEN** only `@lanquarden/pi-dev-worktrees` version is bumped and published

#### Scenario: release both packages
- **GIVEN** the maintainer triggers the workflow
- **AND** selects `package: both`
- **AND** selects `version_bump: minor`
- **WHEN** the workflow runs
- **THEN** both packages are version-bumped and published in sequence

---

### Requirement: Release workflow SHALL run tests before publishing

Before any version bump or publish, the workflow SHALL run `npm ci && npm test --workspaces`.
If tests fail, the workflow SHALL abort without publishing.

#### Scenario: tests fail during release
- **GIVEN** the release workflow is triggered
- **WHEN** `npm test --workspaces` exits with non-zero code
- **THEN** the workflow fails immediately
- **AND** no version bump or publish occurs

---

### Requirement: Release workflow SHALL create git tags

For each released package, the workflow SHALL run `npm version <bump> --workspace=<pkg>`
which creates a git tag (e.g., `pi-dev-worktrees-v0.2.1`) and commits the version bump.
The commit and tag SHALL be pushed back to the repository.

#### Scenario: git tag created
- **GIVEN** `pi-dev-worktrees` is at version `0.2.0`
- **AND** `version_bump: patch` is selected
- **WHEN** `npm version patch --workspace=packages/pi-dev-worktrees` runs
- **THEN** a commit is created with message `0.2.1`
- **AND** a tag `pi-dev-worktrees-v0.2.1` is created
- **AND** both are pushed to the remote

---

### Requirement: Release workflow SHALL publish with public access

`npm publish --workspace=<pkg>` SHALL be called with the npm registry configured
and `NODE_AUTH_TOKEN` set from the `NPM_TOKEN` repository secret. The scoped
packages' `publishConfig.access` is `"public"`, which npm respects automatically.

#### Scenario: package published to npm
- **GIVEN** the version is bumped and pushed
- **WHEN** `npm publish --workspace=packages/pi-dev-worktrees` runs
- **THEN** the package is available at `https://www.npmjs.com/package/@lanquarden/pi-dev-worktrees`

---

### Requirement: Dry-run mode SHALL simulate without publishing

When `dry_run` is `true`, the workflow SHALL run all steps except `npm publish`.
Version bumps SHALL NOT be committed or pushed in dry-run mode.

#### Scenario: dry run skips publish
- **GIVEN** `dry_run: true`
- **WHEN** the workflow reaches the publish step
- **THEN** `npm publish --dry-run` is used instead
- **AND** no git changes are pushed
