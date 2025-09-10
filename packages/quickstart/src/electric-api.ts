import fetch from 'node-fetch'

export interface ElectricCredentials {
  source_id: string
  secret: string
  DATABASE_URL: string
}

const ELECTRIC_API_BASE = `https://api.electric-sql.com`

export async function provisionElectricResources(): Promise<ElectricCredentials> {
  try {
    const response = await fetch(`${ELECTRIC_API_BASE}/v1/provision`, {
      method: `POST`,
      headers: {
        'Content-Type': `application/json`,
        'User-Agent': `@electric-sql/quickstart`,
      },
      body: JSON.stringify({
        type: `starter`,
        template: `tanstack-start`,
      }),
    })

    if (!response.ok) {
      throw new Error(
        `Electric API error: ${response.status} ${response.statusText}`
      )
    }

    const credentials = (await response.json()) as ElectricCredentials

    // Validate response has required fields
    if (
      !credentials.source_id ||
      !credentials.secret ||
      !credentials.DATABASE_URL
    ) {
      throw new Error(
        `Invalid response from Electric API - missing required credentials`
      )
    }

    return credentials
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
    const response = await fetch(`${ELECTRIC_API_BASE}/v1/claim`, {
      method: `POST`,
      headers: {
        'Content-Type': `application/json`,
        Authorization: `Bearer ${secret}`,
        'User-Agent': `@electric-sql/quickstart`,
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
