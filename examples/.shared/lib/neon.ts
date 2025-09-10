export function getNeonConnectionString({
  projectId,
  branchId,
  roleName,
  databaseName,
  pooled,
}: {
  projectId: $util.Input<string>
  branchId: $util.Input<string>
  roleName: $util.Input<string>
  databaseName: $util.Input<string>
  pooled: boolean
}): $util.Output<string> {
  // Compute synchronously via Neon HTTP API (avoids Pulumi provider invokes)
  if (!process.env.NEON_API_KEY) {
    throw new Error(`NEON_API_KEY is not set`)
  }

  const endpointsJson = JSON.parse(
    require('node:child_process').execSync(
      `curl -s -H "Authorization: Bearer $NEON_API_KEY" ` +
        `https://console.neon.tech/api/v2/projects/${projectId}/branches/${branchId}/endpoints`
    ).toString()
  ) as any
  const endpoint = endpointsJson?.endpoints?.[0]
  if (!endpoint?.host || !endpoint?.id) {
    throw new Error(`Failed to resolve Neon branch endpoint`)
  }
  const host = pooled
    ? String(endpoint.host).replace(String(endpoint.id), `${endpoint.id}-pooler`)
    : String(endpoint.host)
  console.log(`[neon] Using ${pooled ? 'pooled' : 'direct'} endpoint`, { host })

  const pwdJson = JSON.parse(
    require('node:child_process').execSync(
      `curl -s -X POST -H "Authorization: Bearer $NEON_API_KEY" ` +
        `https://console.neon.tech/api/v2/projects/${projectId}/branches/${branchId}/roles/${roleName}/reset_password`
    ).toString()
  ) as any
  const password = pwdJson?.password
  if (!password) {
    throw new Error(`Failed to obtain Neon role password`)
  }

  return `postgresql://${roleName}:${password}@${host}/${databaseName}?sslmode=require`
}

/**
 * Uses the [Neon API](https://neon.tech/docs/manage/databases) along with
 * a Pulumi Command resource and `curl` to create and delete Neon databases.
 */
export function createNeonDb({
  projectId,
  branchId,
  dbName,
}: {
  projectId: $util.Input<string>
  branchId: $util.Input<string>
  dbName: $util.Input<string>
}): $util.Output<{
  dbName: string
  ownerName: string
}> {
  if (!process.env.NEON_API_KEY) {
    throw new Error(`NEON_API_KEY is not set`)
  }

  const ownerName = `neondb_owner`

  const createCommand = `
    max_retries=10
    retry_count=0
    
    while [ $retry_count -lt $max_retries ]; do
      response=$(curl -f -s -w "\\n%{http_code}" "https://console.neon.tech/api/v2/projects/$PROJECT_ID/branches/$BRANCH_ID/databases" \
        -H 'Accept: application/json' \
        -H "Authorization: Bearer $NEON_API_KEY" \
        -H 'Content-Type: application/json' \
        -d '{
          "database": {
            "name": "'$DATABASE_NAME'",
            "owner_name": "${ownerName}"
          }
        }' 2>/dev/null)
      
      status_code=$(echo "$response" | tail -n1)
      
      if [ "$status_code" = "423" ]; then
        retry_count=$((retry_count + 1))
        if [ $retry_count -eq $max_retries ]; then
          echo " Max retries reached"
          echo " FAILURE"
          exit 1
        fi
        # Random sleep between 1-5 seconds
        sleep $((RANDOM % 5 + 1))
        continue
      fi
      
      echo " SUCCESS"
      exit 0
    done`

  const updateCommand = `echo "Cannot update Neon database with this provisioning method SUCCESS"`

  const deleteCommand = `curl -f -s -X 'DELETE' \
    "https://console.neon.tech/api/v2/projects/$PROJECT_ID/branches/$BRANCH_ID/databases/$DATABASE_NAME" \
    -H 'Accept: application/json' \
    -H "Authorization: Bearer $NEON_API_KEY" \
    && echo " SUCCESS" || echo " FAILURE"`

  const result = new command.local.Command(`neon-db-command:${dbName}`, {
    create: createCommand,
    update: updateCommand,
    delete: deleteCommand,
    environment: {
      NEON_API_KEY: process.env.NEON_API_KEY,
      PROJECT_ID: projectId,
      BRANCH_ID: branchId,
      DATABASE_NAME: dbName,
    },
  })
  return $resolve([result.stdout, dbName]).apply(([stdout, dbName]) => {
    if (stdout.endsWith(`SUCCESS`)) {
      console.log(`Created Neon database ${dbName}`)
      return {
        dbName,
        ownerName,
      }
    } else {
      throw new Error(`Failed to create Neon database ${dbName}: ${stdout}`)
    }
  })
}
