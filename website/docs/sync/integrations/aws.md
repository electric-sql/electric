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
> See the [Deployment guide](/docs/sync/guides/deployment) for more details.

### Deploy Postgres

AWS provides Postgres hosting via RDS and Aurora. Electric works with either. You need to configure them to enable logical replication and connect with the right user.

Enable logical replication by setting `rds.logical_replication=1` in your [custom parameter group](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithParamGroups.html) for the RDS instance (or the Aurora DB cluster) and rebooting the instance. This sets `wal_level` to `logical`. The PostgreSQL default `wal_level` is `replica`.

The default `postgres` user has the `REPLICATION` role. If you need to add it to another user you can do so by granting the `rds_replication` role, e.g.:

```sql
GRANT rds_replication TO someuser;
```

### Deploy Electric

The recommended way to run Electric on AWS is [Elastic Container Service](https://aws.amazon.com/ecs) (ECS). We maintain example [Terraform and Pulumi configs](#examples) that stand up everything described below.

Electric caches [shape logs](/docs/sync/api/http#shape-log) on disk and treats them as a rebuildable cache: if the disk is lost, Electric rebuilds from Postgres. Disk speed directly drives sync performance, so the main deployment decision is where that disk lives. There are three good options on ECS:

| Launch type | Storage | Characteristics |
|---|---|---|
| [Fargate](https://aws.amazon.com/fargate/) | Ephemeral task storage | Simplest; cache is lost on every deploy |
| EC2, storage&#8209;optimized instance (`i4i`, `m6id`) | Local NVMe instance store | Fastest possible disk; survives task restarts, not host replacement |
| EC2, compute instance (`m6a`, `m6i`, `m7a`, `m7i`) | Attached gp3 EBS data volume | Cheaper; IOPS and throughput independently tunable, in place |

Fargate is fine for evaluation and light workloads. For production workloads, EC2 gives you dramatically better disk for the money — this is how [Electric Cloud](/cloud/) runs.

#### ECS on EC2

The pattern our example configs implement is one task per host:

- A **launch template** using the ECS-optimized Amazon Linux 2023 AMI, with a user-data boot script (below) that prepares the data disk and joins the instance to the cluster.
- An **auto scaling group** (min = max = 1) with scale-in protection and a termination lifecycle hook, so ECS can drain tasks before an instance is replaced.
- An **ECS capacity provider** with managed scaling and managed termination protection, which lets ECS drive the ASG rather than you managing instances directly.
- A **task definition** sized to the whole host: all of its vCPUs, and its memory minus ~2&nbsp;GiB for the OS, Docker and ECS agent. (Undersize this reservation and task placement fails with `RESOURCE:MEMORY` errors.) The task uses `awsvpc` networking behind an ALB targeting `/v1/health`.

#### Bootstrapping the data disk

Both storage options — local NVMe instance store and attached gp3 EBS — appear as non-root `/dev/nvme*` devices on Nitro instances, so a single boot script handles either. On first boot it:

1. finds every non-root NVMe device, waiting up to 60s (EBS volumes attach asynchronously; instance store is present immediately)
2. RAID0s them with `mdadm` if there's more than one (larger `i4i`/`m6id` sizes ship multiple disks)
3. formats XFS and mounts at `/mnt/nvme` with `noatime`, by filesystem UUID rather than device path (NVMe enumeration order isn't guaranteed, and a reassembled RAID array can come back under a different name)
4. creates a data directory owned by uid 1000 (the Electric container user) and writes the ECS cluster-join config

The task then bind-mounts that directory and sets [`ELECTRIC_STORAGE_DIR`](/docs/sync/api/config#electric-storage-dir) to it. The full script is [`shared/user-data.sh.tpl`](https://github.com/electric-sql/electric-aws/blob/main/shared/user-data.sh.tpl) in the examples repo; its core is:

```bash
# Discover non-root NVMe devices (instance store or EBS — both
# appear as /dev/nvme* on Nitro hosts).
DEVS=$(nvme list -o json | jq -r --arg root "$ROOT_PATH" \
  '.Devices[] | select(.DevicePath != $root) | .DevicePath')

# RAID0 multiple disks, else use the single device.
if [ "$COUNT" -gt 1 ]; then
  mdadm --create /dev/md0 --level=0 --raid-devices="$COUNT" $DEVS
  TARGET=/dev/md0
fi

mkfs.xfs -f "$TARGET"

# Name the disk by UUID, since fstab is consulted on every later boot
# but this script only runs on the first one. nofail keeps a blank disk
# (instance store is wiped by a stop/start) from wedging that boot.
FS_UUID=$(blkid -p -s UUID -o value "$TARGET")
echo "UUID=$FS_UUID /mnt/nvme xfs defaults,noatime,nodiscard,nofail 0 2" >> /etc/fstab
mount /mnt/nvme

echo "ECS_CLUSTER=${cluster_name}" >> /etc/ecs/ecs.config
```

#### Sizing storage

For **gp3 EBS**, size, IOPS and throughput are independent knobs you can raise later without downtime (`terraform apply` / `pulumi up` modifies the volume in place; size can grow but never shrink). The 3,000 IOPS / 125 MB/s baseline is free and roughly matches Fargate ephemeral storage; scale up if you see IO wait on shape recomputes or cold starts.

For **NVMe instance store**, capacity comes with the instance type — e.g. 118 GB on an `m6id.large`, 468 GB on an `i4i.large`, with `i4i` giving ~4x the storage per vCPU. You can't tune it, but it's far faster than any networked volume.

Either way, remember the disk contents don't need to survive host replacement — Electric re-syncs from Postgres — but replacing a host does mean re-syncing, so prefer in-place tuning over instance-type churn once you're in production.

### Deploy your app

AWS provides a range of [website hosting options](https://aws.amazon.com/getting-started/hands-on/host-static-website/). For example you can deploy a static app to [AWS Amplify](https://aws.amazon.com/amplify).

## Examples

The [electric-sql/electric-aws](https://github.com/electric-sql/electric-aws) repo contains equivalent [Terraform](https://github.com/electric-sql/electric-aws/tree/main/terraform) and [Pulumi](https://github.com/electric-sql/electric-aws/tree/main/pulumi) configs implementing everything on this page — VPC, RDS with logical replication, ECS (Fargate or EC2 with either storage option) and an ALB.
