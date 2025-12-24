// Using native fetch (Node.js 18+)

export interface ElectricCredentials {
  source_id: string
  secret: string
  DATABASE_URL: string
}

export interface ClaimableSourceResponse {
  claimId: string
}

interface ClaimableSourceStatus {
  state: `pending` | `ready` | `failed`
  source: {
    source_id: string
    secret: string
  }
  connection_uri: string
  claim_link?: string
  project_id?: string
  error: string | null
}

export const DEFAULT_ELECTRIC_API_BASE = `https://dashboard.electric-sql.cloud/api`
export const DEFAULT_ELECTRIC_URL = `https://api.electric-sql.cloud`
export const DEFAULT_ELECTRIC_DASHBOARD_URL = `https://dashboard.electric-sql.cloud`

export function getElectricApiBase(): string {
  return process.env.ELECTRIC_API_BASE_URL ?? DEFAULT_ELECTRIC_API_BASE
}

export function getElectricUrl(): string {
  return process.env.ELECTRIC_URL ?? DEFAULT_ELECTRIC_URL
}

export function getElectricDashboardUrl(): string {
  return process.env.ELECTRIC_DASHBOARD_URL ?? DEFAULT_ELECTRIC_DASHBOARD_URL
}

const POLL_INTERVAL_MS = 1000 // Poll every 1 second
const MAX_POLL_ATTEMPTS = 60 // Max 60 seconds

async function pollClaimableSource(
  claimId: string,
  maxAttempts: number = MAX_POLL_ATTEMPTS
): Promise<ClaimableSourceStatus> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(
      `${getElectricApiBase()}/public/v1/claimable-sources/${claimId}`,
      {
        method: `GET`,
        headers: {
          'User-Agent': `@electric-sql/start`,
        },
      }
    )

    // Handle 404 as "still being provisioned" - continue polling
    if (response.status === 404) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      continue
    }

    // For other non-OK responses, throw an error
    if (!response.ok) {
      throw new Error(
        `Electric API error: ${response.status} ${response.statusText}`
      )
    }

    const status = (await response.json()) as ClaimableSourceStatus

    if (status.state === `ready`) {
      return status
    }

    if (status.state === `failed` || status.error) {
      throw new Error(
        `Resource provisioning failed${status.error ? `: ${status.error}` : ``}`
      )
    }

    // Wait before polling again
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }

  throw new Error(
    `Timeout waiting for resources to be provisioned after ${maxAttempts} attempts`
  )
}

export async function provisionElectricResources(): Promise<
  ElectricCredentials & ClaimableSourceResponse
> {
  console.log(`Provisioning resources...`)
  try {
    // Step 1: POST to create claimable source and get claimId
    const response = await fetch(
      `${getElectricApiBase()}/public/v1/claimable-sources`,
      {
        method: `POST`,
        headers: {
          'Content-Type': `application/json`,
          'User-Agent': `@electric-sql/start`,
        },
        body: JSON.stringify({}),
      }
    )

    if (!response.ok) {
      throw new Error(
        `Electric API error: ${response.status} ${response.statusText}`
      )
    }

    const { claimId } = (await response.json()) as ClaimableSourceResponse

    if (!claimId) {
      throw new Error(`Invalid response from Electric API - missing claimId`)
    }

    // Step 2: Poll until state === 'ready'
    const status = await pollClaimableSource(claimId)

    // Step 3: Extract and validate credentials
    if (
      !status.source?.source_id ||
      !status.source?.secret ||
      !status.connection_uri
    ) {
      throw new Error(
        `Invalid response from Electric API - missing required credentials`
      )
    }

    return {
      source_id: status.source.source_id,
      secret: status.source.secret,
      DATABASE_URL: status.connection_uri,
      claimId,
    }
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(
        `Failed to provision Electric resources: ${error.message}`
      )
    }
    throw new Error(`Failed to provision Electric resources: Unknown error`)
  }
}

export async function claimResources(
  sourceId: string,
  secret: string
): Promise<{ claimUrl: string }> {
  try {
    const response = await fetch(`${getElectricApiBase()}/v1/claim`, {
      method: `POST`,
      headers: {
        'Content-Type': `application/json`,
        Authorization: `Bearer ${secret}`,
        'User-Agent': `@electric-sql/start`,
      },
      body: JSON.stringify({
        source_id: sourceId,
      }),
    })

    if (!response.ok) {
      throw new Error(
        `Electric API error: ${response.status} ${response.statusText}`
      )
    }

    const result = (await response.json()) as { claimUrl: string }

    if (!result.claimUrl) {
      throw new Error(`Invalid response from Electric API - missing claim URL`)
    }

    return result
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to initiate resource claim: ${error.message}`)
    }
    throw new Error(`Failed to initiate resource claim: Unknown error`)
  }
}
