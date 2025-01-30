export async function addDatabaseToElectric({
  uri,
  adminApiTokenId,
  adminApiTokenSecret,
}: {
  uri: string
  adminApiTokenId: string
  adminApiTokenSecret: string
}): Promise<{ id: string; source_secret: string }> {
  const adminApi = process.env.ELECTRIC_ADMIN_API
  const teamId = process.env.ELECTRIC_TEAM_ID

  const result = await fetch(`${adminApi}/v1/sources`, {
    method: `PUT`,
    headers: {
      'Content-Type': `application/json`,
      'CF-Access-Client-Id': adminApiTokenId,
      'CF-Access-Client-Secret': adminApiTokenSecret,
    },
    body: JSON.stringify({
      database_url: uri,
      region: `us-east-1`,
      team_id: teamId,
    }),
  })

  if (!result.ok) {
    throw new Error(
      `Could not add database to Electric (${result.status}): ${await result.text()}`
    )
  }

  return await result.json()
}
