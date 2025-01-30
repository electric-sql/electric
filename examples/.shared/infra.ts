export function getSharedCluster(serviceName: string): sst.aws.Cluster {
  const sharedInfraVpcId = new sst.Secret(`SharedInfraVpcId`)
  const sharedInfraClusterArn = new sst.Secret(`SharedInfraClusterArn`)
  return sst.aws.Cluster.get(`${serviceName}-cluster`, {
    id: sharedInfraClusterArn.value,
    vpc: sst.aws.Vpc.get(`${serviceName}-vpc`, sharedInfraVpcId.value),
  })
}

export const isProduction = () =>
  $app.stage.toLocaleLowerCase() === `production`
