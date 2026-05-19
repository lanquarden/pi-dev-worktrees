# Proposal: npm-publishable Monorepo Structure

**Status:** Implemented
**Date:** 2026-05-19

---

## Why

The repository previously contained a single, flat package with no formal npm metadata — no `name`, `version`, `description`, `license`, or `exports` fields, making it impossible to publish to npm and difficult to install with `pi install npm:…`.

The pi ecosystem expects extensions to be installable as standard npm packages. Users should be able to install `@lanquarden/pi-dev-worktrees` with a single command and get the extension wired up automatically via the `pi` manifest key in `package.json`.

## Problem

1. `packages/pi-dev-worktrees/package.json` lacked all publishable npm fields — no `name` (scoped), `version`, `description`, `license`, `publishConfig`, `keywords`, `repository`, `exports`, or `files`.
2. There was no `pi` manifest key telling pi which file is the extension entry point, so `pi install` from npm would not discover the extension automatically.
3. `packages/pi-dev-worktrees-dashboard-plugin/package.json` was missing `keywords`, making it undiscoverable in the npm registry.
4. The workspace root had no documentation on the two-package layout or how the packages relate.

## Solution

Restructure both `package.json` files to be proper npm-publishable packages:

- Scope both under `@lanquarden/` to avoid naming conflicts.
- Add all required npm fields (`version`, `description`, `license`, `publishConfig`, `keywords`, `repository`, `exports`, `files`).
- Add a `pi` manifest key to `@lanquarden/pi-dev-worktrees` pointing at `./src/index.ts` so `pi install` auto-discovers the extension.
- Add `keywords` to `@lanquarden/pi-dev-worktrees-dashboard-plugin` for registry discoverability (`pi-dashboard-plugin`).

## Scope

- `packages/pi-dev-worktrees/package.json` — full rewrite with all npm fields + `pi` manifest.
- `packages/pi-dev-worktrees-dashboard-plugin/package.json` — add `keywords` only; all other fields were already correct.
- Root `package.json` — left unchanged (`private: true`, workspace root only).

## Alternatives Considered

**Single package with both extension and dashboard plugin bundled together**
Rejected. The dashboard plugin has React peer dependencies (React 18+) that must not be imposed on plain pi extension users. Keeping them as separate npm packages lets users install only what they need.

**Un-scoped names (`pi-dev-worktrees` rather than `@lanquarden/pi-dev-worktrees`)**
Rejected. Un-scoped names in the npm public registry are a finite and contested namespace. Scoping under `@lanquarden` makes ownership clear and avoids conflicts with existing packages.

**Build step (TypeScript → dist/)**
Deferred. Pi loads extensions as source TypeScript files directly (via ts-node / tsx); no compile step is needed. The `exports` and `files` fields point at `src/` intentionally. A build step can be added in a follow-up if a compiled distribution is ever needed.
