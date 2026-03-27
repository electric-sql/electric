# Task: Avoid running TS workflows for Elixir-only changes

## Issue
https://github.com/electric-sql/alco-agent-tasks/issues/17

## Problem
PR #3991 adds a custom `check_ts_changes` gate job that uses the GH API to inspect changed files. This is unnecessary complexity when GitHub's native `paths` workflow filter can achieve the same result.

## Requirements
1. PRs should only run TS CI when TS-related files change
2. Pushes to `main` and `changeset-release/main` should always run TS CI
3. Replace custom gate job with native GitHub workflow `paths` filtering

## Approach
- Use `paths` filter on `pull_request` triggers to only match TS-related files
- Use `push` triggers for `main` and `changeset-release/main` without path filtering (always run)
- No custom scripts or API calls needed
