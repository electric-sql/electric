---
outline: deep
title: Amazon Web Services (AWS) - Integrations
description: >-
  How to deploy Electric on Amazon Web Services (AWS).
image: /img/integrations/electric-aws.jpg
---

<img src="/img/integrations/aws.svg" class="product-icon" />

# Amazon Web Services (AWS)

AWS is a cloud infrastructure platform.

## Electric and AWS

You can use AWS to deploy any or all components of the Electric stack:

- [deploy a Postgres database](#deploy-postgres)
- [an Electric sync service](#deploy-electric)
- [your client application](#deploy-your-app)

If you already run Postgres in AWS, potentially using RDS or Aurora, then it's a great idea to also deploy Electric within the same network.

> [!Tip] Need context?
> See the [Deployment guide](/docs/guides/deployment) for more details.

### Deploy Postgres

AWS provides Postgres hosting via RDS and Aurora. Electric works with either. You need to configure them to enable logical replication and connect with the right user.

Enable logical replication by setting `rds.logical_replication=1` in your [custom parameter group](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithParamGroups.html) for the RDS instance (or the Aurora DB cluster) and rebooting the instance. This sets `wal_level` to `logical`. The PostgreSQL default `wal_level` is `replica`.

The default `postgres` user has the `REPLICATION` role. If you need to add it to another user you can do so by granting the `rds_replication` role, e.g.:

```sql
GRANT rds_replication TO someuser;
```

### Deploy Electric

AWS provides a [wide range of container hosting](https://aws.amazon.com/containers). For example, you can deploy Electric to [AWS Elastic Container Service](https://aws.amazon.com/ecs) using [AWS Fargate](https://aws.amazon.com/fargate).

You should store Shape logs to a persistent disk (not an ephemoral filesystem). For example using [Amazon Elastic File System](https://aws.amazon.com/efs).

### Deploy your app

AWS provides a range of [website hosting options](https://aws.amazon.com/getting-started/hands-on/host-static-website/). For example you can deploy a static app to [AWS Amplify](https://aws.amazon.com/amplify).

## Examples

### AWS Terraform

We have an example Terraform repo at [electric-sql/terraform-aws](https://github.com/electric-sql/terraform-aws).
