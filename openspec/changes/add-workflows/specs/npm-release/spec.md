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

For each released package, the workflow SHALL bump the version with
`npm version --no-git-tag-version`, then create a manual git tag in the
format `v<version>` (e.g., `v0.2.1`) and push both the commit and tag.

#### Scenario: git tag created
- **GIVEN** `pi-dev-worktrees` is at version `0.2.0`
- **AND** `version_bump: patch` is selected
- **WHEN** the release step runs
- **THEN** a commit is created with message `pi-dev-worktrees v0.2.1`
- **AND** a tag `v0.2.1` is created
- **AND** both are pushed to the remote

---

### Requirement: Release workflow SHALL publish using OIDC trusted publishing

The workflow SHALL have `permissions: id-token: write` and `actions/setup-node`
SHALL set `registry-url: https://registry.npmjs.org/`. The npm CLI automatically
detects the OIDC environment and exchanges the GitHub-issued token for a short-lived
publish token. No `NODE_AUTH_TOKEN` or `NPM_TOKEN` secret is required.

The scoped packages' `publishConfig.access` is `"public"`, which npm respects
automatically.

#### Scenario: package published to npm via OIDC
- **GIVEN** the version is bumped and pushed
- **AND** the package has a trusted publisher configured on npmjs.com pointing at this repo and workflow
- **WHEN** `npm publish --workspace=packages/pi-dev-worktrees` runs
- **THEN** the package is available at `https://www.npmjs.com/package/@lanquarden/pi-dev-worktrees`
- **AND** provenance attestations are automatically generated

---

### Requirement: Dry-run mode SHALL simulate without publishing

When `dry_run` is `true`, the workflow SHALL run all steps except `npm publish`.
Version bumps SHALL NOT be committed or pushed in dry-run mode.

#### Scenario: dry run skips publish
- **GIVEN** `dry_run: true`
- **WHEN** the workflow reaches the publish step
- **THEN** `npm publish --dry-run` is used instead
- **AND** no git changes are pushed

---

### Requirement: Release workflow SHALL create a GitHub Release

After publishing each package, the workflow SHALL create a GitHub Release
from the new tag using `gh release create` with auto-generated release notes
(`--generate-notes`). This makes each npm release discoverable on the GitHub
Releases page.

#### Scenario: GitHub Release created after publish
- **GIVEN** `pi-dev-worktrees` is published to npm
- **AND** a git tag exists for the new version
- **WHEN** the release step completes
- **THEN** a GitHub Release is created from the tag
- **AND** release notes are auto-generated from merged pull requests

#### Scenario: dry run does not create GitHub Release
- **GIVEN** `dry_run: true`
- **WHEN** the release step runs
- **THEN** `gh release create` is NOT called
- **AND** a log message shows what would have been created
