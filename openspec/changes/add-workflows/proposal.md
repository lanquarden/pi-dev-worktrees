# Proposal: Add CI/CD Workflows

**Status:** In Progress
**Date:** 2026-05-23

---

## Why

The monorepo has two publishable npm packages (`@lanquarden/pi-dev-worktrees` and `@lanquarden/pi-dev-worktrees-dashboard-plugin`) but no automated CI pipeline. Tests must be run manually, and npm releases must be done by hand. This is error-prone and makes contributions harder to validate.

## Problem

1. There is no automated test runner on push or PR. Contributors (and the maintainer) must remember to run `npm test --workspaces` locally and may forget.
2. Publishing to npm requires manual steps: bumping versions, running `npm publish --workspace=...`, and remembering to pass `--access public` for scoped packages. This is tedious and prone to mistakes.
3. The two packages share a monorepo but may release independently (a worktree bugfix shouldn't force a dashboard-plugin release).

## Solution

Add two GitHub Actions workflows:

1. **`test.yml`** — Runs on every push to `main` and every pull request. Executes `npm ci` and `npm test --workspaces` in a matrix across both packages, confirming all tests pass before merge.

2. **`release.yml`** — Triggered manually (`workflow_dispatch`) with inputs for which package(s) to release and what version bump (patch/minor/major). It runs tests first, then bumps the version with `npm version`, tags the commit, pushes, and publishes to npm with `--access public`.

## What Changes

- `.github/workflows/test.yml` — new CI test workflow
- `.github/workflows/release.yml` — new npm release workflow
- `openspec/specs/ci-test/spec.md` — new spec for the test workflow
- `openspec/specs/npm-release/spec.md` — new spec for the release workflow

## Scope

GitHub Actions workflow files only. No source code changes.

## Alternatives Considered

**Single workflow that both tests and releases**
Rejected. Testing should run on every push/PR automatically; releasing should be an explicit manual action. Combining them would mean every PR triggers a release prompt.

**Changesets for versioning**
Deferred. Changesets add complexity for a two-package monorepo with a single maintainer. The `workflow_dispatch` with version-bump input is simpler and sufficient. Changesets can be adopted later if the contributor base grows.

**Using `npm workspaces` publish instead of per-package**
Rejected. The two packages have independent version lifecycles. `npm publish --workspace` from root already handles per-package publishing while respecting workspace dependencies.
