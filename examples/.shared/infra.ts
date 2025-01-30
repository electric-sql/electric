export function getSharedCluster(serviceName: string): sst.aws.Cluster {
  const sharedInfraVpcId = process.env.SHARED_INFRA_VPC_ID
  const sharedInfraClusterArn = process.env.SHARED_INFRA_CLUSTER_ARN
  if (!sharedInfraVpcId || !sharedInfraClusterArn) {
    throw new Error(
      `SHARED_INFRA_VPC_ID or SHARED_INFRA_CLUSTER_ARN is not set`
    )
  }

  return sst.aws.Cluster.get(`${serviceName}-cluster`, {
    id: sharedInfraClusterArn,
    vpc: sst.aws.Vpc.get(`${serviceName}-vpc`, sharedInfraVpcId),
  })
}

export const isProduction = () =>
  $app.stage.toLocaleLowerCase() === `production`
