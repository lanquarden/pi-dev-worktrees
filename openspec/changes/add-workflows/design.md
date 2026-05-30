# Design: CI/CD Workflows

## D1 — Test workflow trigger

**Decision:** `on: [push, pull_request]` with `branches: [main]`.

**Rationale:** Tests should run on every push to main (post-merge verification) and on every PR targeting main (pre-merge gate). Pushes to feature branches don't need CI unless a PR is opened — saving runner minutes.

---

## D2 — Test workflow strategy

**Decision:** Single job, no matrix. `npm ci` at root installs all workspace dependencies. `npm test --workspaces` runs both packages' test suites sequentially.

**Rationale:** The two packages are small and their tests complete in seconds. A matrix would add unnecessary overhead (two checkout + install cycles). If packages grow enough that test isolation matters, a matrix can be added later.

---

## D3 — Release workflow trigger

**Decision:** `workflow_dispatch` with three inputs:
- `package` (choice: `pi-dev-worktrees`, `pi-dev-worktrees-dashboard-plugin`, `both`)
- `version_bump` (choice: `patch`, `minor`, `major`)
- `dry_run` (boolean, default `false`)

**Rationale:** Manual triggering gives the maintainer full control over when and what to release. The version bump choice aligns with semver. Dry-run mode lets the maintainer verify the process without actually publishing.

---

## D4 — Release workflow versioning strategy

**Decision:** Use `npm version <bump> --no-git-tag-version` to bump the version in `package.json` without auto-tagging, then manually create a `v<version>` tag (e.g., `v0.2.1`). Commit, tag, and push, then run `npm publish --access public`.

**Rationale:** Both packages release in lock step, so a simple `v<version>` tag is cleaner than npm's default per-workspace tag format (`@scope/name@version`). `--no-git-tag-version` gives us full control over tag naming. Explicit `--access public` makes the public visibility intent clear even though `publishConfig.access` is set.

---

## D5 — npm authentication

**Decision:** Use OIDC trusted publishing. The workflow has `permissions: id-token: write` and `actions/setup-node` sets `registry-url: https://registry.npmjs.org/`. The npm CLI (>= 11.5.1 on Node >= 22.14.0) detects the OIDC environment and exchanges the GitHub-issued token for a short-lived npm publish token automatically.

No `NPM_TOKEN` secret or `NODE_AUTH_TOKEN` env var is needed.

**Rationale:** Eliminates the security risk of long-lived tokens. Each publish uses a short-lived, workflow-specific credential. npm also automatically generates provenance attestations when publishing via OIDC.

---

## D6 — Both packages release

**Decision:** When `package` input is `both`, release sequentially: bump + publish pi-dev-worktrees first, then bump + publish dashboard-plugin.

**Rationale:** The dashboard plugin depends on pi-dev-worktrees conceptually (it decorates sessions that use the extension), but there is no npm dependency between them. Sequential release is safe and simple.

---

## D7 — GitHub Release creation

**Decision:** After publishing, create a GitHub Release from the `v<version>` tag using `gh release create --generate-notes`.

**Rationale:** `--generate-notes` auto-populates the release with merged PRs and commits since the last tag, making each release discoverable on the GitHub Releases page without manual changelog maintenance. The `gh` CLI is pre-installed on GitHub Actions runners and uses the `GITHUB_TOKEN` from checkout.
