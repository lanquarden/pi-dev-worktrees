# Design: npm-publishable Monorepo Structure

## D1 — Package Scoping

**Decision:** Both packages are scoped under `@lanquarden/`.

**Rationale:** Scoping under the author's npm username (`lanquarden`) makes ownership unambiguous and allows `publishConfig.access: "public"` to work on npm without organisation overhead. It also mirrors the pattern used by the existing `@blackbelt-technology/pi-dashboard-shared` dependency, keeping naming conventions consistent within the ecosystem.

---

## D2 — `pi` Manifest Key

**Decision:** Add `"pi": { "extensions": ["./src/index.ts"] }` to `@lanquarden/pi-dev-worktrees/package.json`.

**Rationale:** The pi package system discovers extensions from the `pi.extensions` array in `package.json` (or falls back to an `extensions/` directory). Declaring the entry point explicitly means `pi install npm:@lanquarden/pi-dev-worktrees` installs and wires up the extension in one step with no manual `settings.json` editing. The path `./src/index.ts` is the existing module entry point; pi loads TypeScript extensions directly, so no build step is needed.

**The `pi` key is NOT added to the dashboard plugin.** The dashboard plugin is not a pi extension — it is a pi-agent-dashboard UI plugin identified by the `pi-dashboard-plugin` key, which was already present and correct.

---

## D3 — `exports` Field

**Decision:**

```json
// @lanquarden/pi-dev-worktrees
"exports": {
  ".": {
    "types": "./src/index.ts",
    "default": "./src/index.ts"
  }
}

// @lanquarden/pi-dev-worktrees-dashboard-plugin
"exports": {
  ".": { "types": "./src/client/index.tsx", "default": "./src/client/index.tsx" },
  "./client": { "types": "./src/client/index.tsx", "default": "./src/client/index.tsx" }
}
```

**Rationale:** Both packages ship TypeScript source files as the canonical artefact (no `dist/`). Pointing `exports` at `.ts`/`.tsx` files is consistent with the pi package convention and allows bundlers / pi's own loader to pick up the types directly.

---

## D4 — `files` Field

**Decision:** `"files": ["src/"]` for both packages.

**Rationale:** The `files` allowlist limits what `npm pack` / `npm publish` includes. `src/` contains all runtime code; `tests/`, `node_modules/`, and lock files are excluded automatically. This keeps the published tarball small and free of test artefacts.

---

## D5 — `keywords`

**Decision:**

```json
// @lanquarden/pi-dev-worktrees
"keywords": ["pi-package", "pi-extension", "git", "worktrees", "devcontainer"]

// @lanquarden/pi-dev-worktrees-dashboard-plugin
"keywords": ["pi-dashboard-plugin", "pi-dev-worktrees", "git", "worktrees", "devcontainer"]
```

**Rationale:** `pi-package` is the convention used by the pi package gallery for discoverability. `pi-dashboard-plugin` distinguishes the UI plugin from a pi extension. Feature tags (`git`, `worktrees`, `devcontainer`) aid search.

---

## D6 — `peerDependencies`

**Decision:** `@earendil-works/pi-coding-agent` and `typebox` remain in `peerDependencies` with `"*"` range for `@lanquarden/pi-dev-worktrees`. Not bundled.

**Rationale:** Per pi package documentation: "If you import any of these, list them in `peerDependencies` with a `"*"` range and do not bundle them." Pi provides these at runtime; bundling them would cause version conflicts.

---

## D7 — Installation Instructions

After these changes, users can install with:

```bash
# Pi extension only
pi install npm:@lanquarden/pi-dev-worktrees

# Dashboard plugin (installed by pi-agent-dashboard separately)
npm install @lanquarden/pi-dev-worktrees-dashboard-plugin
```

The README should document these commands.
