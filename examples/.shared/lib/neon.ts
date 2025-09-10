export function getNeonConnectionString({
  project,
  roleName,
  databaseName,
  pooled,
}: {
  project: $util.Output<neon.GetProjectResult>
  roleName: $util.Input<string>
  databaseName: $util.Input<string>
  pooled: boolean
}): $util.Output<string> {
  const passwordOutput = neon.getBranchRolePasswordOutput({
    projectId: project.id,
    branchId: project.defaultBranchId,
    roleName: roleName,
  })

  const endpoint = neon.getBranchEndpointsOutput({
    projectId: project.id,
    branchId: project.defaultBranchId,
  })
  const databaseHost = pooled
    ? endpoint.endpoints?.apply((endpoints) =>
        endpoints![0].host.replace(
          endpoints![0].id,
          endpoints![0].id + `-pooler`
        )
      )
    : project.databaseHost
  if (pooled) {
    endpoint.endpoints?.apply((endpoints) =>
      console.log(`[neon] Using pooled endpoint`, { host: endpoints?.[0]?.host })
    )
  } else {
    project.databaseHost.apply((host) =>
      console.log(`[neon] Using direct endpoint`, { host })
    )
  }
  return $interpolate`postgresql://${passwordOutput.roleName}:${passwordOutput.password}@${databaseHost}/${databaseName}?sslmode=require`
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
