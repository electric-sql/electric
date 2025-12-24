# Deploy Quickstart Demo to quickstart.examples.electric-sql.com

## Goal

Deploy the `examples/tanstack-db-web-starter` app to `https://quickstart.examples.electric-sql.com` so the demo link in the quickstart guide works.

**Target URL**: `https://quickstart.examples.electric-sql.com`
**Source**: `examples/tanstack-db-web-starter`

---

## Context

### Why This Deployment is Different

The quickstart app (`tanstack-db-web-starter`) differs from other examples in the repo:

| Aspect     | Quickstart App                                | Typical Example (e.g., `react`) |
| ---------- | --------------------------------------------- | ------------------------------- |
| Framework  | TanStack Start (full-stack)                   | Vite (static site)              |
| Database   | Own schema (users, sessions, projects, todos) | Shared `items` table            |
| Auth       | Better Auth                                   | None                            |
| API        | tRPC                                          | Direct Electric sync            |
| Migrations | Drizzle ORM                                   | Shared pg-migrations            |

Because it has server-side functionality (tRPC, auth), it needs a server runtime — but **not SSR** (server-side rendering of React components). The app already has `defaultSsr: false` set in `src/start.tsx`.

### How Electric Examples Are Deployed

All examples use a consistent pattern:

- **Infrastructure**: SST v3 on AWS + Cloudflare DNS + Neon Postgres
- **CI/CD**: GitHub Actions workflows
- **Domains**:
  - Production: `{example}.examples.electric-sql.com`
  - PR previews: `{example}-stage-pr-{N}.examples.electric-sql.com`

### What SST Component We'll Use

**`sst.aws.TanStackStart`** — SST's native component for TanStack Start apps:

- Deploys to AWS Lambda + CloudFront
- Handles API routes (tRPC, auth) via Lambda
- Serves static assets via CloudFront
- Works with `defaultSsr: false` — React renders client-side, Lambda handles API routes only

This is simpler than a split deployment (separate StaticSite + ECS service) and matches SST's recommended approach.

---

## Implementation

### Phase 1: App Configuration (In-Repo)

#### 1.1 Create `app.config.ts`

SST's TanStackStart component requires the AWS Lambda preset.

**File**: `examples/tanstack-db-web-starter/app.config.ts`

```typescript
import { defineConfig } from '@tanstack/react-start/config'

export default defineConfig({
  server: {
    preset: 'aws-lambda',
  },
})
```

#### 1.2 Create `sst.config.ts`

This configures the SST deployment. Key aspects:

- Uses `TanStackStart` component for Lambda + CloudFront deployment
- Creates separate Neon database for quickstart (not shared `items` table)
- Runs Drizzle migrations during deploy
- Registers database with Electric Cloud

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
      removal: input?.stage === `production` ? `retain` : `remove`,
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
    if (!process.env.ELECTRIC_API) {
      throw new Error(`ELECTRIC_API environment variable is required`)
    }
    if (!process.env.BETTER_AUTH_SECRET) {
      throw new Error(`BETTER_AUTH_SECRET environment variable is required`)
    }

    const dbName = isProduction()
      ? `quickstart-production`
      : `quickstart-${$app.stage}`

    const dbConfig = getQuickstartSource(dbName)

    const website = new sst.aws.TanStackStart(`quickstart-website`, {
      environment: {
        // Database
        DATABASE_URL: dbConfig.pooledDatabaseUri,

        // Electric
        ELECTRIC_URL: process.env.ELECTRIC_API,
        ELECTRIC_SOURCE_ID: dbConfig.sourceId,
        ELECTRIC_SOURCE_SECRET: dbConfig.sourceSecret,

        // Better Auth
        BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
        BETTER_AUTH_URL: `https://quickstart${isProduction() ? `` : `-stage-${$app.stage}`}.examples.electric-sql.com`,
      },
      domain: {
        name: `quickstart${isProduction() ? `` : `-stage-${$app.stage}`}.examples.electric-sql.com`,
        dns: sst.cloudflare.dns(),
      },
    })

    return {
      website: website.url,
    }
  },
})

// -----------------------------------------------------------------------------
// Database helpers
// -----------------------------------------------------------------------------

/**
 * Get or create a database for the quickstart.
 * - Production: Uses pre-configured credentials from environment
 * - PR stages: Creates a new Neon database via API
 */
function getQuickstartSource(dbName: string) {
  if (isProduction()) {
    if (
      !process.env.QUICKSTART_DATABASE_URI ||
      !process.env.QUICKSTART_POOLED_DATABASE_URI ||
      !process.env.QUICKSTART_SOURCE_ID ||
      !process.env.QUICKSTART_SOURCE_SECRET
    ) {
      throw new Error(
        `Production requires QUICKSTART_DATABASE_URI, QUICKSTART_POOLED_DATABASE_URI, ` +
          `QUICKSTART_SOURCE_ID, and QUICKSTART_SOURCE_SECRET`
      )
    }

    const databaseUri = process.env.QUICKSTART_DATABASE_URI

    // Apply migrations (idempotent)
    applyDrizzleMigrations(databaseUri)

    return {
      sourceId: process.env.QUICKSTART_SOURCE_ID,
      sourceSecret: process.env.QUICKSTART_SOURCE_SECRET,
      databaseUri,
      pooledDatabaseUri: process.env.QUICKSTART_POOLED_DATABASE_URI,
    }
  }

  // PR stages: Create new database
  return createQuickstartDatabase({ dbName })
}

/**
 * Creates a new Neon database for PR stages and registers with Electric.
 */
function createQuickstartDatabase({ dbName }: { dbName: string }) {
  const neonProjectId = process.env.NEON_PROJECT_ID
  if (!neonProjectId) {
    throw new Error(`NEON_PROJECT_ID is not set`)
  }

  // Get default branch ID from Neon API
  type NeonBranchesResponse = {
    branches?: Array<{ id: string; default?: boolean }>
  }
  const branchesJson = JSON.parse(
    execSync(
      `curl -s -H "Authorization: Bearer $NEON_API_KEY" ` +
        `https://console.neon.tech/api/v2/projects/${neonProjectId}/branches`,
      { env: process.env }
    ).toString()
  ) as NeonBranchesResponse

  const defaultBranchId = branchesJson?.branches?.find((b) => b.default)?.id
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

  // Apply migrations after database is created
  return databaseUri
    .apply((uri) => applyDrizzleMigrations(uri))
    .apply(() => res)
}

/**
 * Apply migrations using Drizzle Kit.
 * Migrations are in src/db/out/ (generated by drizzle-kit generate).
 */
function applyDrizzleMigrations(dbUri: string) {
  console.log(`[quickstart] Applying Drizzle migrations`)
  execSync(`pnpm drizzle-kit migrate`, {
    env: {
      ...process.env,
      DATABASE_URL: dbUri,
    },
  })
}

/**
 * Register a database with Electric Cloud.
 */
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
      `ELECTRIC_ADMIN_API, ELECTRIC_TEAM_ID, and ELECTRIC_ADMIN_API_AUTH_TOKEN must be set`
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
    return JSON.parse(output) as { id: string; source_secret: string }
  })
}
```

### Phase 2: GitHub Workflow Updates (In-Repo)

#### 2.1 Update `deploy_examples.yml`

**File**: `.github/workflows/deploy_examples.yml`

Add quickstart to the monitored files (~line 40):

```yaml
files: |
  yjs/**
  ...existing entries...
  tanstack-db-web-starter/**
```

Add output (~line 87):

```yaml
tanstack-db-web-starter: ${{ steps.deploy.outputs.tanstack-db-web-starter }}
```

Add environment variables (~line 108):

```yaml
QUICKSTART_DATABASE_URI: ${{ secrets.QUICKSTART_DATABASE_URI }}
QUICKSTART_POOLED_DATABASE_URI: ${{ secrets.QUICKSTART_POOLED_DATABASE_URI }}
QUICKSTART_SOURCE_ID: ${{ vars.QUICKSTART_SOURCE_ID }}
QUICKSTART_SOURCE_SECRET: ${{ secrets.QUICKSTART_SOURCE_SECRET }}
BETTER_AUTH_SECRET: ${{ secrets.BETTER_AUTH_SECRET }}
```

Add to comment URLs (~line 294):

```yaml
"tanstack-db-web-starter": "${{ needs.deploy.outputs.tanstack-db-web-starter }}",
```

#### 2.2 Update `deploy_all_examples.yml`

**File**: `.github/workflows/deploy_all_examples.yml`

Add to matrix (~line 35):

```yaml
- name: tanstack-db-web-starter
  path: examples/tanstack-db-web-starter
```

Add same environment variables as above.

#### 2.3 Update `teardown_examples_pr_stack.yml`

**File**: `.github/workflows/teardown_examples_pr_stack.yml`

Add to matrix (~line 30):

```yaml
'tanstack-db-web-starter',
```

### Phase 3: Production Database Setup (One-Time, Manual)

This only needs to be done once. PR stages create their own databases automatically.

#### 3.1 Create Neon Database

```bash
# Get the default branch ID
BRANCH_ID=$(curl -s -H "Authorization: Bearer $NEON_API_KEY" \
  "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches" \
  | jq -r '.branches[] | select(.default==true) | .id')

# Create the database
curl -X POST "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches/$BRANCH_ID/databases" \
  -H "Authorization: Bearer $NEON_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"database": {"name": "quickstart-production", "owner_name": "neondb_owner"}}'
```

#### 3.2 Apply Migrations

From Neon console, get the direct connection string, then:

```bash
cd examples/tanstack-db-web-starter
DATABASE_URL="postgresql://..." pnpm drizzle-kit migrate
```

#### 3.3 Register with Electric Cloud

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

Save the returned `id` and `source_secret`.

#### 3.4 Generate Auth Secret

```bash
openssl rand -base64 32
```

#### 3.5 Add GitHub Secrets/Variables

**Secrets** (Settings > Secrets and variables > Actions > Secrets):

| Secret                           | Value                           |
| -------------------------------- | ------------------------------- |
| `QUICKSTART_DATABASE_URI`        | Direct Neon connection string   |
| `QUICKSTART_POOLED_DATABASE_URI` | Pooled Neon connection string   |
| `QUICKSTART_SOURCE_SECRET`       | Electric source secret from 3.3 |
| `BETTER_AUTH_SECRET`             | Generated in 3.4                |

**Variables** (Settings > Secrets and variables > Actions > Variables):

| Variable               | Value                       |
| ---------------------- | --------------------------- |
| `QUICKSTART_SOURCE_ID` | Electric source ID from 3.3 |

---

## Checklist

### In-Repo Changes

- [ ] Create `examples/tanstack-db-web-starter/app.config.ts`
- [ ] Create `examples/tanstack-db-web-starter/sst.config.ts`
- [ ] Update `.github/workflows/deploy_examples.yml`
- [ ] Update `.github/workflows/deploy_all_examples.yml`
- [ ] Update `.github/workflows/teardown_examples_pr_stack.yml`

### One-Time Production Setup

- [ ] Create Neon database `quickstart-production`
- [ ] Apply migrations with `drizzle-kit migrate`
- [ ] Register with Electric Cloud Admin API
- [ ] Generate `BETTER_AUTH_SECRET`
- [ ] Add GitHub secrets and variables

### Verification

- [ ] https://quickstart.examples.electric-sql.com loads
- [ ] User signup works
- [ ] Project creation works
- [ ] Todo creation with real-time sync works

---

## Reference

### Existing Patterns

- **SST TanStackStart docs**: https://sst.dev/docs/component/aws/tanstack-start
- **Similar example**: `examples/tanstack/sst.config.ts` (uses split deployment, but shows database/Electric patterns)
- **Shared infra helpers**: `examples/.shared/lib/infra.ts`

### Key Files

| File                                                 | Purpose                 |
| ---------------------------------------------------- | ----------------------- |
| `examples/tanstack-db-web-starter/src/start.tsx`     | Has `defaultSsr: false` |
| `examples/tanstack-db-web-starter/src/db/schema.ts`  | Drizzle schema          |
| `examples/tanstack-db-web-starter/src/db/out/*.sql`  | Generated migrations    |
| `examples/tanstack-db-web-starter/drizzle.config.ts` | Drizzle configuration   |
