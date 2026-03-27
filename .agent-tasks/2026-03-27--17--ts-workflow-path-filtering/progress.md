# Progress Log

## 2026-03-27

### Analysis
- Read PR #3991 diff and current workflow files on main
- PR adds a `check_ts_changes` gate job to both `ts_tests.yml` and `ts_check_formatting.yml`
- The gate job uses GH API to fetch changed files and matches them against a regex
- This can be replaced with GitHub's native `paths` filter on `pull_request` triggers

### Key observations
- `ts_tests.yml` currently has `paths-ignore` for website/README/integration-tests on both push and PR
- `ts_check_formatting.yml` currently only triggers on `pull_request` with `paths-ignore` for README/integration-tests/Elixir packages
- Neither workflow currently triggers on `changeset-release/main`
- PR #3991's regex includes website as TS-related, but ts_tests currently ignores website — I'll keep website out of ts_tests paths to preserve current behavior

### Implementation plan
1. `ts_tests.yml`: Change push branches to include `changeset-release/main`, replace `paths-ignore` on PR trigger with `paths` include list
2. `ts_check_formatting.yml`: Add push trigger for `main` and `changeset-release/main`, replace `paths-ignore` on PR trigger with `paths` include list

### Implementation
- Implemented both changes as planned
- Pushed to `alco:erik/ts-workflow-path-filtering`
- Opened PR: https://github.com/electric-sql/electric/pull/4067 with `claude` label for review
