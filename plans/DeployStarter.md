# Deploy Quickstart Demo to quickstart.examples.electric-sql.com

## Executive Summary

Deploy the `examples/tanstack-db-web-starter` as a demo at `https://quickstart.examples.electric-sql.com` so the link in the quickstart guide (`website/docs/quickstart.md`) works.

**Target URL**: `https://quickstart.examples.electric-sql.com`
**Source**: `examples/tanstack-db-web-starter`

### Key Decisions

- **Seed data**: None - demo starts empty, visitors sign up
- **PR previews**: Yes, using Neon branching
- **e2e tests**: None for this example
- **Migrations**: Fully automated during deployment

---

## Background Investigation

### Current Infrastructure Pattern

The Electric examples use a consistent deployment pattern:

- **Infrastructure**: SST v2 on AWS + Cloudflare DNS + Neon Postgres
- **Automation**: GitHub Actions workflows for CI/CD
- **Domain pattern**: `{example-name}.examples.electric-sql.com` for production
- **PR previews**: `{example-name}-stage-pr-{number}.examples.electric-sql.com`

### Existing Workflows Reviewed

| Workflow                                           | Purpose                                              |
| -------------------------------------------------- | ---------------------------------------------------- |
| `.github/workflows/deploy_examples.yml`            | Auto-deploys on push to main (only changed examples) |
| `.github/workflows/deploy_all_examples.yml`        | Manual trigger to deploy all examples                |
| `.github/workflows/teardown_examples_pr_stack.yml` | Cleans up PR stacks when PRs close                   |
| `.github/workflows/test_examples.yml`              | Daily e2e tests against production examples          |

### Quickstart App Architecture

The `tanstack-db-web-starter` is significantly different from other examples:

| Aspect         | Quickstart                                 | Typical Example (e.g., react) |
| -------------- | ------------------------------------------ | ----------------------------- |
| Framework      | TanStack Start (SSR)                       | Vite static site              |
| Database       | Drizzle ORM with auth tables               | Shared simple `items` table   |
| Schema         | users, sessions, accounts, projects, todos | items                         |
| Migrations     | Drizzle-generated (`src/db/out/*.sql`)     | `.shared/db/migrations/`      |
| Authentication | Better Auth (sessions, accounts)           | None                          |
| API Layer      | tRPC                                       | Direct Electric sync          |
| SST Component  | `TanStackStart` (Lambda + CloudFront)      | `StaticSite`                  |

---

## Deployment Architecture Decision

### Option A: SST TanStackStart Component (Recommended)

SST provides native support for TanStack Start apps via the `TanStackStart` component:

- Deploys to AWS Lambda + CloudFront
- Handles SSR properly
- Requires `server.preset: "aws-lambda"` configuration

**Pros**: Native SST support, consistent with team tooling
**Cons**: Requires app configuration changes for AWS Lambda preset

### Option B: Docker Service on ECS (Like `tanstack` example)

Deploy as a containerized service on the shared ECS cluster.

**Pros**: More control, no need to modify app preset
**Cons**: More complex, requires Dockerfile, uses cluster resources

### Recommendation

Use **Option A** (SST TanStackStart) as it's cleaner and officially supported by SST.

---

## Implementation Plan

### Phase 1: App Configuration Changes (In-Repo)

#### 1.1 Create `app.config.ts` for AWS Lambda preset

**File**: `examples/tanstack-db-web-starter/app.config.ts`

```typescript
import { defineConfig } from '@tanstack/react-start/config'

export default defineConfig({
  server: {
    preset: 'aws-lambda',
  },
})
```

This is **required** by SST's TanStackStart component.

#### 1.2 Add `@databases/pg-migrations` dependency

**File**: `examples/tanstack-db-web-starter/package.json`

Add to devDependencies:

```json
{
  "devDependencies": {
    "@databases/pg-migrations": "^5.0.3"
  }
}
```

#### 1.3 Copy migration to pg-migrations format

The quickstart uses Drizzle which outputs to `src/db/out/`. To use the shared `applyMigrations` infrastructure, copy the migration SQL to a `db/migrations/` directory.

**File**: `examples/tanstack-db-web-starter/db/migrations/01-init.sql`

Copy content from `src/db/out/0000_slimy_frank_castle.sql` (the Drizzle-generated migration).

This allows the standard `pg-migrations apply` to work during deployment.

#### 1.4 Create `sst.config.ts`

**File**: `examples/tanstack-db-web-starter/sst.config.ts`

```typescript
/// <reference path="./.sst/platform/config.d.ts" />

import { execSync } from 'node:child_process'
import { isProduction } from '../.shared/lib/infra'
import { createNeonDb, getNeonConnectionStrings } from '../.shared/lib/neon'

export default $config({
  app(input) {
    return {
      name: `quickstart-example`,
      removal:
        input?.stage.toLocaleLowerCase() === `production` ? `retain` : `remove`,
      protect: [`production`].includes(input?.stage),
      home: `aws`,
      providers: {
        cloudflare: `5.42.0`,
        aws: {
          version: `6.66.2`,
          profile: process.env.CI ? undefined : `marketing`,
        },
        neon: `0.6.3`,
        command: `1.0.1`,
      },
    }
  },
  async run() {
    // Validate required environment variables
    if (!process.env.ELECTRIC_API || !process.env.ELECTRIC_ADMIN_API) {
      throw new Error(
        `Env variables ELECTRIC_API and ELECTRIC_ADMIN_API must be set`
      )
    }
    if (!process.env.BETTER_AUTH_SECRET) {
      throw new Error(`BETTER_AUTH_SECRET environment variable is required`)
    }

    const dbName = isProduction()
      ? `quickstart-production`
      : `quickstart-${$app.stage}`

    // Get database configuration (creates new DB for PR stages via Neon branching)
    const dbConfig = getQuickstartSource(dbName)

    const quickstart = new sst.aws.TanStackStart(`quickstart-website`, {
      environment: {
        // Database
        DATABASE_URL: dbConfig.pooledDatabaseUri,

        // Electric
        ELECTRIC_SOURCE_ID: dbConfig.sourceId,
        ELECTRIC_SOURCE_SECRET: dbConfig.sourceSecret,

        // Better Auth
        BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
      },
      domain: {
        name: `quickstart${isProduction() ? `` : `-stage-${$app.stage}`}.examples.electric-sql.com`,
        dns: sst.cloudflare.dns(),
      },
    })

    return {
      website: quickstart.url,
    }
  },
})

/**
 * Get or create a database for the quickstart example.
 * - Production: Uses pre-configured shared database credentials
 * - PR stages: Creates a new Neon database via branching API
 */
function getQuickstartSource(dbName: string) {
  const migrationsDirectory = `./db/migrations`

  if (isProduction()) {
    // Production uses pre-configured database
    if (
      !process.env.QUICKSTART_DATABASE_URI ||
      !process.env.QUICKSTART_POOLED_DATABASE_URI ||
      !process.env.QUICKSTART_SOURCE_ID ||
      !process.env.QUICKSTART_SOURCE_SECRET
    ) {
      throw new Error(
        `QUICKSTART_DATABASE_URI, QUICKSTART_POOLED_DATABASE_URI, QUICKSTART_SOURCE_ID, and QUICKSTART_SOURCE_SECRET must be set in production`
      )
    }

    const databaseUri = process.env.QUICKSTART_DATABASE_URI

    // Apply migrations (idempotent)
    applyMigrations(databaseUri, migrationsDirectory)

    return {
      sourceId: process.env.QUICKSTART_SOURCE_ID,
      sourceSecret: process.env.QUICKSTART_SOURCE_SECRET,
      databaseUri,
      pooledDatabaseUri: process.env.QUICKSTART_POOLED_DATABASE_URI,
    }
  }

  // PR stages: Create new database via Neon API (branching)
  return createQuickstartDatabase({ dbName, migrationsDirectory })
}

/**
 * Creates a new Neon database for PR stages and registers with Electric.
 * Uses the same pattern as .shared/lib/database.ts but for quickstart schema.
 */
function createQuickstartDatabase({
  dbName,
  migrationsDirectory,
}: {
  dbName: string
  migrationsDirectory: string
}) {
  const neonProjectId = process.env.NEON_PROJECT_ID
  if (!neonProjectId) {
    throw new Error(`NEON_PROJECT_ID is not set`)
  }

  // Get default branch ID
  type NeonBranchesResponse = {
    branches?: Array<{ id: string; default?: boolean }>
  }
  const branchesJson = JSON.parse(
    execSync(
      `curl -s -H "Authorization: Bearer $NEON_API_KEY" https://console.neon.tech/api/v2/projects/${neonProjectId}/branches`,
      { env: process.env }
    ).toString()
  ) as unknown as NeonBranchesResponse
  const defaultBranchId = branchesJson?.branches?.find(
    (b) => b.default === true
  )?.id
  if (!defaultBranchId) {
    throw new Error(`Could not resolve Neon default branch id`)
  }

  // Create database
  const { ownerName, dbName: resultingDbName } = createNeonDb({
    projectId: neonProjectId,
    branchId: defaultBranchId,
    dbName,
  })

  // Get connection strings
  const connectionStrings = getNeonConnectionStrings({
    projectId: neonProjectId,
    branchId: defaultBranchId,
    roleName: ownerName,
    databaseName: resultingDbName,
  })

  const databaseUri = connectionStrings.direct
  const pooledDatabaseUri = connectionStrings.pooled

  // Register with Electric Cloud
  const electricInfo = addDatabaseToElectric({
    dbUri: databaseUri,
    pooledDbUri: pooledDatabaseUri,
  })

  const res = {
    sourceId: electricInfo.id,
    sourceSecret: electricInfo.source_secret,
    databaseUri,
    pooledDatabaseUri,
  }

  // Apply migrations
  return databaseUri
    .apply((uri) => applyMigrations(uri, migrationsDirectory))
    .apply(() => res)
}

function applyMigrations(dbUri: string, migrationsDir: string) {
  console.log(`[quickstart] Applying migrations`, { directory: migrationsDir })
  execSync(`pnpm exec pg-migrations apply --directory ${migrationsDir}`, {
    env: {
      ...process.env,
      DATABASE_URL: dbUri,
    },
  })
}

function addDatabaseToElectric({
  dbUri,
  pooledDbUri,
}: {
  dbUri: $util.Input<string>
  pooledDbUri?: $util.Input<string>
}): $util.Output<{ id: string; source_secret: string }> {
  const adminApi = process.env.ELECTRIC_ADMIN_API
  const teamId = process.env.ELECTRIC_TEAM_ID
  const adminApiAuthToken = process.env.ELECTRIC_ADMIN_API_AUTH_TOKEN

  if (!adminApi || !teamId || !adminApiAuthToken) {
    throw new Error(
      `ELECTRIC_ADMIN_API, ELECTRIC_TEAM_ID, or ELECTRIC_ADMIN_API_AUTH_TOKEN is not set`
    )
  }

  const createCommand = `curl --fail-with-body -s -X PUT $ADMIN_API_URL/v1/sources \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $ADMIN_API_TOKEN" \
    -d $SOURCE_CONFIG`

  const electricSourceCommand = new command.local.Command(
    `quickstart-electric-source`,
    {
      create: createCommand,
      update: createCommand,
      delete: `curl --fail-with-body -s -X DELETE $ADMIN_API_URL/v1/sources/$(echo $PULUMI_COMMAND_STDOUT | jq -r .id) \
        -H "Authorization: Bearer $ADMIN_API_TOKEN" \
        && sleep 10`,
      addPreviousOutputInEnv: true,
      environment: {
        ADMIN_API_URL: adminApi,
        ADMIN_API_TOKEN: adminApiAuthToken,
        SOURCE_CONFIG: $jsonStringify({
          database_url: dbUri,
          options: {
            db_pool_size: 5,
            ...(pooledDbUri ? { pooled_database_url: pooledDbUri } : {}),
          },
          region: `us-east-1`,
          team_id: teamId,
        }),
      },
    }
  )

  return electricSourceCommand.stdout.apply((output) => {
    const parsedOutput = JSON.parse(output) as {
      id: string
      source_secret: string
    }
    return parsedOutput
  })
}
```

### Phase 2: One-Time Production Database Setup (Manual)

For production only - PR stages are fully automated via Neon branching.

#### 2.1 Create Neon Database

Using Neon console or CLI:

```bash
# Get default branch ID
BRANCH_ID=$(curl -s -H "Authorization: Bearer $NEON_API_KEY" \
  "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches" \
  | jq -r '.branches[] | select(.default==true) | .id')

# Create database
curl -X POST "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches/$BRANCH_ID/databases" \
  -H "Authorization: Bearer $NEON_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"database": {"name": "quickstart-production", "owner_name": "neondb_owner"}}'
```

#### 2.2 Get Connection Strings

From the Neon console, get:

- Direct connection string (for migrations)
- Pooled connection string (for runtime)

#### 2.3 Apply Initial Migrations

```bash
cd examples/tanstack-db-web-starter
DATABASE_URL="postgresql://..." pnpm exec pg-migrations apply --directory ./db/migrations
```

#### 2.4 Register with Electric Cloud

```bash
curl -X PUT "$ELECTRIC_ADMIN_API/v1/sources" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ELECTRIC_ADMIN_API_AUTH_TOKEN" \
  -d '{
    "database_url": "postgresql://...(direct)...",
    "options": {
      "db_pool_size": 5,
      "pooled_database_url": "postgresql://...(pooled)..."
    },
    "region": "us-east-1",
    "team_id": "'"$ELECTRIC_TEAM_ID"'"
  }'
```

Save the returned `id` (SOURCE_ID) and `source_secret` (SOURCE_SECRET).

#### 2.5 Generate BETTER_AUTH_SECRET

```bash
openssl rand -base64 32
```

### Phase 3: GitHub Secrets/Variables (Manual)

Add the following to GitHub repository settings.

#### Secrets (Settings > Secrets and variables > Actions > Secrets)

| Secret Name                      | Description                                    |
| -------------------------------- | ---------------------------------------------- |
| `QUICKSTART_DATABASE_URI`        | Direct Neon connection string (for migrations) |
| `QUICKSTART_POOLED_DATABASE_URI` | Pooled Neon connection string (for runtime)    |
| `QUICKSTART_SOURCE_SECRET`       | Electric source secret                         |
| `BETTER_AUTH_SECRET`             | Secret for Better Auth sessions (min 32 chars) |

#### Variables (Settings > Secrets and variables > Actions > Variables)

| Variable Name          | Description        |
| ---------------------- | ------------------ |
| `QUICKSTART_SOURCE_ID` | Electric source ID |

### Phase 4: Update GitHub Workflows (In-Repo)

#### 4.1 Update `deploy_examples.yml`

Add to the file list (line ~40):

```yaml
files: |
  yjs/**
  ...existing entries...
  tanstack-db-web-starter/**  # ADD THIS
```

Add to outputs section (line ~87):

```yaml
tanstack-db-web-starter: ${{ steps.deploy.outputs.tanstack-db-web-starter }}
```

Add to env section (line ~108):

```yaml
QUICKSTART_DATABASE_URI: ${{ secrets.QUICKSTART_DATABASE_URI }}
QUICKSTART_POOLED_DATABASE_URI: ${{ secrets.QUICKSTART_POOLED_DATABASE_URI }}
QUICKSTART_SOURCE_ID: ${{ vars.QUICKSTART_SOURCE_ID }}
QUICKSTART_SOURCE_SECRET: ${{ secrets.QUICKSTART_SOURCE_SECRET }}
BETTER_AUTH_SECRET: ${{ secrets.BETTER_AUTH_SECRET }}
```

Add to comment job's URLs object (line ~294):

```yaml
"tanstack-db-web-starter": "${{ needs.deploy.outputs.tanstack-db-web-starter }}",
```

#### 4.2 Update `deploy_all_examples.yml`

Add to matrix (line ~35):

```yaml
- name: tanstack-db-web-starter
  path: examples/tanstack-db-web-starter
```

Add to env section:

```yaml
QUICKSTART_DATABASE_URI: ${{ secrets.QUICKSTART_DATABASE_URI }}
QUICKSTART_POOLED_DATABASE_URI: ${{ secrets.QUICKSTART_POOLED_DATABASE_URI }}
QUICKSTART_SOURCE_ID: ${{ vars.QUICKSTART_SOURCE_ID }}
QUICKSTART_SOURCE_SECRET: ${{ secrets.QUICKSTART_SOURCE_SECRET }}
BETTER_AUTH_SECRET: ${{ secrets.BETTER_AUTH_SECRET }}
```

#### 4.3 Update `teardown_examples_pr_stack.yml`

Add to matrix (line ~30):

```yaml
'tanstack-db-web-starter',
```

---

## Implementation Checklist

### In-Repo Changes (Can Be Done Now)

- [ ] Create `examples/tanstack-db-web-starter/app.config.ts` with AWS Lambda preset
- [ ] Add `@databases/pg-migrations` to package.json devDependencies
- [ ] Create `examples/tanstack-db-web-starter/db/migrations/01-init.sql` (copy from Drizzle output)
- [ ] Create `examples/tanstack-db-web-starter/sst.config.ts`
- [ ] Update `.github/workflows/deploy_examples.yml`
- [ ] Update `.github/workflows/deploy_all_examples.yml`
- [ ] Update `.github/workflows/teardown_examples_pr_stack.yml`

### One-Time Production Setup (Requires Infrastructure Access)

- [ ] Create Neon database "quickstart-production" on default branch
- [ ] Get Neon connection strings (direct + pooled)
- [ ] Apply initial migrations via `pg-migrations apply`
- [ ] Register database with Electric Cloud Admin API
- [ ] Generate BETTER_AUTH_SECRET (`openssl rand -base64 32`)
- [ ] Add GitHub secrets: `QUICKSTART_DATABASE_URI`, `QUICKSTART_POOLED_DATABASE_URI`, `QUICKSTART_SOURCE_SECRET`, `BETTER_AUTH_SECRET`
- [ ] Add GitHub variable: `QUICKSTART_SOURCE_ID`
- [ ] Trigger deployment via push to main or manual workflow_dispatch

### Post-Deployment Verification

- [ ] Verify https://quickstart.examples.electric-sql.com loads
- [ ] Test user signup flow
- [ ] Test project creation
- [ ] Test todo creation with real-time sync
- [ ] Verify quickstart guide link works

---

## Risk Assessment

### High Risk Items

1. **SST TanStackStart Support**: This is relatively new. The GitHub issue [sst/sst#5653](https://github.com/sst/sst/issues/5653) shows some deployment issues. Test thoroughly.

2. **Different Schema**: The quickstart has auth tables and triggers. If shared database credentials are accidentally used, it will fail.

3. **BETTER_AUTH_SECRET**: If not set or too short, authentication will fail.

4. **Migration Sync**: If schema changes in Drizzle but `db/migrations/` isn't updated, production will be out of sync.

### Mitigation

- Test SST TanStackStart locally with `sst dev` first
- Use completely separate environment variables for quickstart database
- Document the secret generation process
- Add CI check to ensure `db/migrations/` matches Drizzle output (optional future enhancement)

---

## Alternative Approaches

### If SST TanStackStart Fails

#### Fallback: Docker Service Deployment

1. Create Dockerfile:

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY . .
RUN pnpm install && pnpm build
CMD ["node", ".output/server/index.mjs"]
```

2. Use `cluster.addService()` pattern like `examples/tanstack/sst.config.ts`

### If Tight Timeline

#### Minimal Viable: Static StackBlitz Fork

The quickstart guide already has a StackBlitz link. If SST deployment is complex, ensure the StackBlitz link works while resolving deployment issues.

---

## Automation Summary

| Stage                           | Automation Level                                 |
| ------------------------------- | ------------------------------------------------ |
| Production database creation    | One-time manual                                  |
| Production database migrations  | **Automated** (runs on every deploy, idempotent) |
| PR database creation            | **Automated** (Neon branching via API)           |
| PR database migrations          | **Automated** (pg-migrations apply)              |
| PR Electric source registration | **Automated** (Admin API curl)                   |
| PR cleanup                      | **Automated** (SST remove on PR close)           |
| Production deployment           | **Automated** (GitHub Actions on push to main)   |

---

## Timeline Estimate

| Task                                                          | Effort                    |
| ------------------------------------------------------------- | ------------------------- |
| App config changes (app.config.ts, sst.config.ts, migrations) | Low                       |
| GitHub workflow updates                                       | Low                       |
| One-time production DB setup                                  | Low-Medium                |
| GitHub secrets configuration                                  | Low                       |
| Testing and debugging                                         | Medium-High               |
| **Total**                                                     | **~Half day to full day** |

**Note**: The "Medium-High" testing effort is because TanStackStart on SST is newer and may have edge cases.

---

## References

- [SST TanStackStart docs](https://sst.dev/docs/component/aws/tan-stack-start/)
- [SST TanStack Start tutorial](https://sst.dev/docs/start/aws/tanstack/)
- [TanStack Start hosting guide](https://tanstack.com/start/latest/docs/framework/react/guide/hosting)
- [SST TanStackStart issue #5653](https://github.com/sst/sst/issues/5653)

---

## Appendix: File Locations

| File                                                | Purpose                           |
| --------------------------------------------------- | --------------------------------- |
| `examples/tanstack-db-web-starter/`                 | Quickstart source code            |
| `examples/tanstack-db-web-starter/src/db/out/*.sql` | Drizzle migrations                |
| `examples/.shared/lib/infra.ts`                     | Shared SST infrastructure helpers |
| `.github/workflows/deploy_examples.yml`             | PR/main deployment workflow       |
| `.github/workflows/deploy_all_examples.yml`         | Manual full deploy workflow       |
| `.github/workflows/teardown_examples_pr_stack.yml`  | PR cleanup workflow               |
| `website/docs/quickstart.md`                        | Documentation with link to demo   |
