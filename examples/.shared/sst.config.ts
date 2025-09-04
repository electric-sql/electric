// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app() {
    return {
      name: `examples-infra`,
      removal: `remove`,
      home: `aws`,
      providers: {
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
    const { default: camelcase } = await import(`camelcase`)
    const provider = new aws.Provider(
      camelcase(`examples-infra-provider-${$app.stage}`),
      {
        region: `us-east-1`,
      }
    )
    const vpc = new sst.aws.Vpc(
      camelcase(`examples-infra-vpc-${$app.stage}`),
      {},
      { provider: provider }
    )

    const cluster = new sst.aws.Cluster(
      camelcase(`examples-infra-cluster-${$app.stage}`),
      { vpc },
      { provider }
    )

    // Set the following environment variables with the shared infra
    // in GitHub CI environment
    // SHARED_INFRA_VPC_ID
    // SHARED_INFRA_CLUSTER_ARN
    return {
      sharedVpc: vpc.id,
      sharedCluster: cluster.id,
    }
  },
})
