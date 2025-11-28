import { execSync } from 'node:child_process'

type NeonEndpointsResponse = {
  endpoints?: Array<{ host: string; id: string }>
}

type NeonResetPasswordResponse = {
  role?: { password?: string }
}

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

  return $resolve([projectId, branchId, roleName, databaseName]).apply(
    ([pid, bid, role, db]) => {
      const endpointsJson = JSON.parse(
        execSync(
          `curl -s -H "Authorization: Bearer $NEON_API_KEY" ` +
            `https://console.neon.tech/api/v2/projects/${pid}/branches/${bid}/endpoints`
        ).toString()
      ) as unknown as NeonEndpointsResponse
      const endpoint = endpointsJson?.endpoints?.[0]
      if (!endpoint?.host || !endpoint?.id) {
        throw new Error(`Failed to resolve Neon branch endpoint`)
      }
      const host = pooled
        ? String(endpoint.host).replace(
            String(endpoint.id),
            `${endpoint.id}-pooler`
          )
        : String(endpoint.host)
      console.log(`[neon] Using ${pooled ? `pooled` : `direct`} endpoint`, {
        host,
      })

      const pwdResp = execSync(
        `curl -s -w "\\n%{http_code}" -X POST -H "Authorization: Bearer $NEON_API_KEY" ` +
          `https://console.neon.tech/api/v2/projects/${pid}/branches/${bid}/roles/${role}/reset_password`,
        { env: process.env }
      )
        .toString()
        .trim()

      const status = pwdResp.slice(pwdResp.lastIndexOf(`\n`) + 1)
      const body = pwdResp.slice(0, pwdResp.lastIndexOf(`\n`))

      if (status !== `200`) {
        console.error(`[neon] Password reset failed with status ${status}`)
        if (body) {
          try {
            const errorJson = JSON.parse(body)
            console.error(`[neon] Error response: ${JSON.stringify(errorJson)}`)
          } catch {
            console.error(`[neon] Error response (raw): ${body}`)
          }
        }
        throw new Error(`Failed to reset Neon role password: HTTP ${status}`)
      }

      const pwdJson = JSON.parse(body) as unknown as NeonResetPasswordResponse
      const password = pwdJson?.role?.password
      if (!password) {
        console.error(
          `[neon] Password reset returned 200 but password not found in response`
        )
        console.error(
          `[neon] Response keys: ${Object.keys(pwdJson || {}).join(`, `)}`
        )
        if (pwdJson?.role) {
          console.error(
            `[neon] Role object keys: ${Object.keys(pwdJson.role).join(`, `)}`
          )
        }
        console.error(
          `[neon] Full response: ${JSON.stringify(pwdJson, null, 2)}`
        )
        throw new Error(`Failed to obtain Neon role password`)
      }

      return `postgresql://${role}:${password}@${host}/${db}?sslmode=require`
    }
  )
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
