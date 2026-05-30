# Tasks: Add CI/CD Workflows

---

## 1. CI test workflow

- [x] 1.1 Create `.github/workflows/test.yml`
  - Trigger: `push` + `pull_request` on `main`
  - Steps: checkout, setup Node 22, `npm ci`, `npm test --workspaces`

---

## 2. Release workflow

- [x] 2.1 Create `.github/workflows/release.yml`
  - Trigger: `workflow_dispatch` with inputs:
    - `package` (choice: pi-dev-worktrees | pi-dev-worktrees-dashboard-plugin | both)
    - `version_bump` (choice: patch | minor | major)
    - `dry_run` (boolean, default false)
  - Steps:
    - Checkout
    - Setup Node 22 with npm registry (OIDC trusted publishing — no NPM_TOKEN needed)
    - `npm ci`
    - Run tests (`npm test --workspaces`)
    - Configure git user (actions bot)
    - For each selected package: bump version (`npm version --no-git-tag-version`), commit, create `v<version>` tag, push commit + tag, `npm publish --access public`, create GitHub Release (`gh release create v<version> --generate-notes`)
    - Skip publish and release creation in dry-run mode

---

## 3. Verification

- [x] 3.1 Confirm `.github/workflows/test.yml` exists and is valid YAML
- [x] 3.2 Confirm `.github/workflows/release.yml` exists and is valid YAML
- [x] 3.3 Push branch and verify test workflow triggers on the PR
