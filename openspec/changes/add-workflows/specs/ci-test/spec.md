# ci-test Specification

## Purpose

The repository SHALL have an automated CI workflow that runs tests on every push to
`main` and every pull request targeting `main`, ensuring all packages' tests pass
before merge.
## Requirements
### Requirement: Test workflow SHALL trigger on push and PR to main

A GitHub Actions workflow at `.github/workflows/test.yml` SHALL trigger on `push`
events to `main` and `pull_request` events targeting `main`.

#### Scenario: push to main triggers tests
- **GIVEN** a commit is pushed to `main`
- **WHEN** the push event fires
- **THEN** the test workflow runs

#### Scenario: PR targeting main triggers tests
- **GIVEN** a pull request is opened or updated targeting `main`
- **WHEN** the `pull_request` event fires
- **THEN** the test workflow runs

---

### Requirement: Test workflow SHALL install dependencies and run all workspace tests

The workflow SHALL use Node.js 22 (LTS) and execute:
1. `npm ci` to install workspace dependencies
2. `npm test --workspaces` to run all package test suites

#### Scenario: all tests pass
- **GIVEN** dependencies are installed
- **WHEN** `npm test --workspaces` runs
- **AND** all test suites exit with code 0
- **THEN** the workflow succeeds (green check)

#### Scenario: any test fails
- **GIVEN** dependencies are installed
- **WHEN** `npm test --workspaces` runs
- **AND** at least one test suite exits with non-zero code
- **THEN** the workflow fails (red X)
