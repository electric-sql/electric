---
title: CLI
description: >-
  Command-line interface for managing Electric Cloud resources — Electric Sync sources and Electric Streams services.
image: /img/meta/electric-cloud.jpg
outline: deep
---

# CLI

Command-line interface for [Electric Cloud](https://dashboard.electric-sql.cloud) &mdash; manage workspaces, projects, environments and services from the terminal. The CLI provides full control over your Cloud resources, from provisioning [Electric&nbsp;Sync](/sync/) sources and [Electric&nbsp;Streams](/streams/) services to managing per-PR environments in CI/CD pipelines. All commands support JSON output for scripting and&nbsp;automation.

For an overview of what these resources are, see the [Usage guide](/cloud/usage).

## Installation

Install globally:

```shell
npm install -g @electric-sql/cli
```

Or run directly with `npx`:

```shell
npx @electric-sql/cli --help
```

## Authentication

The CLI checks for credentials in this order:

### 1. Browser login

For interactive use, log in via OAuth:

```shell
electric auth login
```

This opens the Electric Cloud dashboard in your browser. After authenticating, your session is stored locally at `~/.config/electric/auth.json` and is valid for 7 days.

### 2. `ELECTRIC_API_TOKEN` environment variable

Set a token in your environment for CI/CD pipelines:

```shell
export ELECTRIC_API_TOKEN=sv_live_...
electric projects list
```

### 3. `--token` flag

Pass a token directly for one-off commands or scripts:

```shell
electric projects list --token sv_live_...
```

## Provision an Electric Sync source

```shell
electric projects create --name "my-app"
electric environments create --project proj_abc --name "staging"
electric services create postgres \
  --environment env_abc \
  --database-url "postgresql://user:pass@host:5432/db" \
  --region us-east-1
```

## Provision an Electric Streams service

```shell
electric services create streams \
  --environment env_abc \
  --region us-east-1
```

## Fetch service credentials

```shell
electric services get-secret svc_abc
```

## Per-PR environments

```shell
# Create an environment for the PR
ENV_ID=$(electric environments create \
  --project "$PROJECT_ID" --name "pr-$PR_NUMBER" \
  --json | jq -r '.id')

electric services create postgres \
  --environment "$ENV_ID" \
  --database-url "$DATABASE_URL" \
  --region us-east-1

# Tear down when the PR is closed
electric environments delete "$ENV_ID" --force
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `ELECTRIC_API_TOKEN` | API token for authentication |
| `ELECTRIC_WORKSPACE_ID` | Default workspace ID |
| `ELECTRIC_API_URL` | Override API base URL |

## JSON output

All commands support `--json` for machine-readable output:

```shell
electric projects list --json
```

Destructive commands (`delete`, `revoke`) require `--force` when using `--json` since there is no interactive prompt.
