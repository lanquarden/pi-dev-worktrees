# Tasks: npm-publishable Monorepo Structure

---

## 1. `packages/pi-dev-worktrees/package.json` — full rewrite

- [x] 1.1 Set `"name"` to `"@lanquarden/pi-dev-worktrees"`
- [x] 1.2 Add `"version": "0.1.0"`
- [x] 1.3 Add `"description": "Pi extension for isolated branch workspaces — git worktrees via wtp and optional devcontainer targeting"`
- [x] 1.4 Add `"license": "MIT"`
- [x] 1.5 Add `"keywords": ["pi-package", "pi-extension", "git", "worktrees", "devcontainer"]`
- [x] 1.6 Add `"publishConfig": { "access": "public" }`
- [x] 1.7 Add `"repository"` pointing at `https://github.com/BlackBeltTechnology/pi-worktrees` with `directory: packages/pi-dev-worktrees`
- [x] 1.8 Add `"exports"` with `"."` pointing at `./src/index.ts` for both `types` and `default`
- [x] 1.9 Add `"files": ["src/"]`
- [x] 1.10 Add `"pi": { "extensions": ["./src/index.ts"] }`

---

## 2. `packages/pi-dev-worktrees-dashboard-plugin/package.json` — add keywords

- [x] 2.1 Add `"keywords": ["pi-dashboard-plugin", "pi-dev-worktrees", "git", "worktrees", "devcontainer"]`

---

## 3. Verification

- [x] 3.1 Run `npm test --workspaces` — all tests pass with updated package names
- [x] 3.2 Confirm `packages/pi-dev-worktrees/package.json` contains all required fields
- [x] 3.3 Confirm `packages/pi-dev-worktrees-dashboard-plugin/package.json` contains `keywords`

---

## 4. Commit

- [x] 4.1 Commit with message: `feat: add npm package specs for monorepo structure`
