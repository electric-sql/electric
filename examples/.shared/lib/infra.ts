import { applyMigrations, createDatabaseForCloudElectric } from "./database"

export function getSharedCluster(serviceName: string): sst.aws.Cluster {
  const sharedInfraVpcId = process.env.SHARED_INFRA_VPC_ID
  const sharedInfraClusterArn = process.env.SHARED_INFRA_CLUSTER_ARN
  if (!sharedInfraVpcId || !sharedInfraClusterArn) {
    throw new Error(
      "SHARED_INFRA_VPC_ID or SHARED_INFRA_CLUSTER_ARN is not set"
    )
  }

  return sst.aws.Cluster.get(`${serviceName}-cluster`, {
    id: sharedInfraClusterArn,
    vpc: sst.aws.Vpc.get(`${serviceName}-vpc`, sharedInfraVpcId),
  })
}

/**
 * Returns the shared example database if we are in the production stage.
 * Otherwise, it creates a new database with the given name.
 */
export function getExampleSource(dbName: string) {
  // Path is relative to the directory where sst is called from
  // which we do from the individual example directories
  const migrationsDirectory = "../.shared/db/migrations"

  if (isProduction()) {
    if (
      !process.env.SHARED_EXAMPLES_DATABASE_URI ||
      !process.env.SHARED_EXAMPLES_POOLED_DATABASE_URI ||
      !process.env.SHARED_EXAMPLES_SOURCE_ID ||
      !process.env.SHARED_EXAMPLES_SOURCE_SECRET
    ) {
      throw new Error(
        "SHARED_EXAMPLES_DATABASE_URI, SHARED_EXAMPLES_POOLED_DATABASE_URI, SHARED_EXAMPLES_SOURCE_ID, and SHARED_EXAMPLES_SOURCE_SECRET must be set in production"
      )
    }

    const databaseUri = process.env.SHARED_EXAMPLES_DATABASE_URI

    // Migrate the database (is idempotent)
    applyMigrations(databaseUri, migrationsDirectory)

    return {
      sourceId: process.env.SHARED_EXAMPLES_SOURCE_ID,
      sourceSecret: process.env.SHARED_EXAMPLES_SOURCE_SECRET,
      databaseUri,
      pooledDatabaseUri: process.env.SHARED_EXAMPLES_POOLED_DATABASE_URI,
    }
  }

  return createDatabaseForCloudElectric({
    dbName,
    migrationsDirectory,
  })
}

export const isProduction = () =>
  $app.stage.toLocaleLowerCase() === "production"
