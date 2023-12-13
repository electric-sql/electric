---
title: DigitalOcean
description: >-
  Fully-managed infrastructure.
sidebar_position: 20
---

DigitalOcean is a cloud provider that is easy to use and has a low starting cost. You can get a virtual machine running in the cloud within minutes or deploy a web app to their fully-managed App Platform in just a few clicks.

Make sure you have a DigitalOcean account with billing activated before you follow one of the guides below.

## Running Electric on App Platform

App Platform is a Platform-as-a-Service (PaaS) offering that allows developers to publish code directly to DigitalOcean servers without worrying about the underlying infrastructure.

### Deploying Electric

Before deploying Electric, make sure you have a Postgres database with logical replication enabled hosted somewhere where Electric will be able to connect to it. Retrieve your database's connection URI with password included and use it as the value of the `DATABASE_URL` variable when customizing the app.

Click on the "Deploy to DO" button below to be taken to DigitalOcean's Create App wizard.

<div style={{display: "flex", "justify-content": "center"}}>

[![Deploy to DO](https://www.deploytodo.com/do-btn-white.svg)](https://cloud.digitalocean.com/apps/new?repo=https://github.com/electric-sql/deploy-to-do/tree/service-only)

</div>

![Create App: Resources](./digital-ocean/create-app/resources.png)

Click on the "Edit Plan" button, pick the Basic plan and the Basic instance size. That will be enough to get started.

![Create App: Edit Plan](./digital-ocean/create-app/edit-plan.png)

Go to the next page and click on the Edit link next to the `electric` service.

![Create App: Environment](./digital-ocean/create-app/environment.png)

Fill in the values for `DATABASE_URL` and `PG_PROXY_PASSWORD`. Make sure you pick a strong proxy password as the proxy effectively makes it possible to connect to your database over the public Internet in this particular deployment scenario.

![Create App: Edit Environment](./digital-ocean/create-app/env-vars.png)

You can leave the `AUTH_MODE` insecure for now but remember to switch to the secure mode and add a secret signing key before making your app available to users.

Click "Save" and go the next page.

![Create App: Info](./digital-ocean/create-app/info.png)

Here you can pick a different region for the app. We recommend choosing the same (or the closest) region to the one where your database is running.

Finally, go to the Review page and click on the "Create Resources" button at the bottom.

![Create App: Review](./digital-ocean/create-app/review.png)

You'll be taken to the new app's Settings tab. Click on the Activity tab to see the deployment status and logs. It should only take a minute before the app goes live.

![Create App: Activity](./digital-ocean/create-app/activity.png)

Congratulations! You have deployed Electric as a DigitalOcean app. Verify that it's fully initialized by opening `https://<your app name>.ondigitalocean.app/api/status`, or using `curl`:

```shell
$ curl -i https://electric-sync-service-4ha5b.ondigitalocean.app/api/status
Connection to Postgres is up!
```

If you see errors in the logs, there's likely a problem with some of the environment variables. To update the environment, go to the Settings tab, click on the `electric` component at the top and then click on the Edit link in the "Environment Variables" row.

![Create App: Component Settings](./digital-ocean/create-app/component-settings.png)

Saving your changes to Environment Variables will trigger a new deployment for the app. Once that finishes, check Deploy logs and Runtime logs to see if there are any more issues remaining.

### Running the basic example app

Let's see how to set up a client app to connect to the Electric sync service we've just deployed. Clone the source code repository to your machine and navigate to the basic example, as explained on [this page](../../examples/basic#source-code).

#### Apply migrations

Apps running on DigitalOcean's App Platform can only accept HTTP/HTTPS connections. In order to connect to the migrations proxy that runs inside Electric, we need to start a local server that will tunnel TCP traffic over HTTP between a local Postgres client and the migrations proxy:

```shell
npx electric-sql proxy-tunnel \
    --service https://electric-sync-service-4ha5b.ondigitalocean.app \
    --local-port 8000
```

Electric can work alongside any tooling you use to manage database migrations with. See the <DocPageLink path="integrations/backend" /> section of the docs for an overview of the most popular frameworks. In this demo we'll use `@databases/pg-migrations` as it's already included in the basic example. Make sure you have installed all of the dependencies by running `yarn` once.

Before running the following commands, export an environment variable `PG_PROXY_PASSWORD` on your local using the same value as the one configured for the DigitalOcean app:

```shell
export PG_PROXY_PASSWORD=...
```

Run `npx pg-migrations apply` to apply the migration included in the example to your database via the proxy tunnel:

```shell
$ npx pg-migrations apply \
      --directory db/migrations \
      --database postgresql://postgres:$PG_PROXY_PASSWORD@localhost:8000/postgres
Applying 01-create_items_table.sql
Applied 01-create_items_table.sql
1 migrations applied
```

#### Generate a type-safe client

Now that the database has one electrified table, we can [generate a type-safe client](../../usage/data-access/client.md) from it. Use the same database connection URL as in the previous step but change the username to `prisma` (this is required for the schema introspection to work correctly).

```shell
$ npx electric-sql generate
      --service https://electric-sync-service-4ha5b.ondigitalocean.app
      --proxy postgresql://prisma:$PG_PROXY_PASSWORD@localhost:8000/postgres
Generating Electric client...
Successfully generated Electric client at: ./src/generated/client
Building migrations...
Successfully built migrations
```

#### Start the app!

Now you should have everything ready to start the web app and have it connected to the Electric sync service running as a DigitalOcean app:

```shell
$ ELECTRIC_URL='wss://electric-sync-service-4ha5b.ondigitalocean.app' \
  SERVE=true \
  npm run build

> electric-sql-wa-sqlite-example@0.7.0 build
> node copy-wasm-files.js && node builder.js

Your app is running at http://localhost:3001
```

## Running Electric on a Droplet

DigitalOcean Droplets are virtual servers that can run a variety of Linux distros. For this guide, we'll create a new Droplet using an OS image from DigitalOcean Marketplace that has Docker pre-installed. We will then be able to connect to the Docker daemon running on the virtual server from a local computer.

### Creating a new Droplet

A new Droplet can be created in the web UI, by sending an HTTP request to DigitalOcean API, or using the `doctl` command-line tool. We'll look at the web UI approach first.

Choose Create -> Droplets in your DigitalOcean dashboard or open https://cloud.digitalocean.com/droplets/new in a new browser tab to reach the Droplet creation page.

The first step is choosing the region for your new Droplet. We recommend choosing the same (or the closest) region to the one where your database is running.

![Create Droplet: Choose Region](./digital-ocean/create-droplet/choose-region.png)

Next, choose the "Docker on Ubuntu" image by clicking on the Marketplace tab and typing in "docker" in the search field.

![Create Droplet: Choose Image](./digital-ocean/create-droplet/choose-image.png)

For the Droplet size you may pick the cheapest available option.

![Create Droplet: Choose Size](./digital-ocean/create-droplet/choose-size.png)

We'll need key-based SSH authentication to set up our local Docker to talk to the remote daemon. Make sure you have your SSH key added in account settings and pick it during Droplet creation process.

![Create Droplet: Choose Auth](./digital-ocean/create-droplet/choose-auth.png)

Finally, click on the "Create Droplet" button to finish the setup.

![Create Droplet: Finalize Details](./digital-ocean/create-droplet/finalize-details.png)

Your new Droplet should be ready in a few minutes.

### Using doctl

As an alternative to using the web wizard, you could also create a new Droplet with one command by using the official `doctl` application.

First, look up the fingerprint of the SSH key uploaded to your DigitalOcean account:

```shell
$ doctl compute ssh-key list
ID          Name                     FingerPrint
40136022    ThinkPad T480s Fedora    40:ec:31:78:28:5f:7d:4e:6d:14:8c:51:c2:66:45:ae
```

Now create a new Droplet with the same parameters as above by executing the following command:

```shell
$ doctl compute droplet create \
    --region fra1 \
    --image docker-20-04 \
    --size s-1vcpu-1gb \
    --ssh-keys 40:ec:31:78:28:5f:7d:4e:6d:14:8c:51:c2:66:45:ae \
    electric-droplet
ID           Name                Public IPv4    Private IPv4    Public IPv6    Memory    VCPUs    Disk    Region    Image                                   VPC UUID    Status    Tags    Features         Volumes
388388331    electric-droplet                                                  1024      1        25      fra1      Ubuntu Docker 23.0.6 on Ubuntu 22.04                new               droplet_agent
```

Wait a couple of minutes for the Droplet creation process to finish and for a public IP address to be allocated to it:

```shell
$ doctl compute droplet list
ID           Name                Public IPv4       Private IPv4    Public IPv6    Memory    VCPUs    Disk    Region    Image                                   VPC UUID                                Status    Tags    Features                            Volumes
388388331    electric-droplet    167.99.132.206    10.114.0.3                     1024      1        25      fra1      Ubuntu Docker 23.0.6 on Ubuntu 22.04    6fddb427-6728-4133-a17d-9251bcaf8fa8    active            droplet_agent,private_networking
```

### Configuring Docker to talk to the remote daemon

You need to connect to your new Droplet once using `ssh` in order to verify the authenticity of host and add its public key to the local `known_hosts` file.

:::tip
If you get the "Conncetion refused" error when you try to ssh into the Droplet using its public IP address, wait a couple of minutes to allow the Droplet to finish its initialization.
:::

```shell
$ ssh root@167.99.132.206
ssh: connect to host 167.99.132.206 port 22: Connection refused

$ ssh root@167.99.132.206
The authenticity of host '167.99.132.206 (167.99.132.206)' can't be established.
ED25519 key fingerprint is SHA256:bC5UdSujpgx/12Z0JfJb6wAEx7/IkqEKe9eX9VLzVzg.
This key is not known by any other names
// highlight-next-line
Are you sure you want to continue connecting (yes/no/[fingerprint])? yes
Warning: Permanently added '167.99.132.206' (ED25519) to the list of known hosts.
```

Now that you have the host added, set the `DOCKER_HOST` environment variable to point to Droplet's IP address:

```shell
export DOCKER_HOST=ssh://root@167.99.132.206
```

Docker commands will now be executing against the remote Docker daemon:

```shell
$ docker ps
CONTAINER ID   IMAGE     COMMAND   CREATED   STATUS    PORTS     NAMES

$ docker images
REPOSITORY   TAG       IMAGE ID   CREATED   SIZE
```

### Deploying Electric using Docker Compose

Save the following contents into a file called `compose.yaml`, changing the values for the environment variables to match your setup.

```yaml
version: "3.1"
services:
  electric:
    image: electricsql/electric
    environment:
      DATABASE_URL: "postgresql://postgres:******@example.com/postgres"
      PG_PROXY_PASSWORD: "******"
      AUTH_MODE: "insecure"
      ELECTRIC_WRITE_TO_PG_MODE: "direct_writes"
    ports:
      - 80:5133
      - 65432:65432
    restart: always
```

Now launch a new Docker container on the remote server that will run Electric connected to your database:

```shell
$ docker compose up
[+] Running 8/8
 ✔ electric 7 layers [⣿⣿⣿⣿⣿⣿⣿]      0B/0B      Pulled                    6.5s
   ✔ 759700526b78 Pull complete                                            0.6s
   ✔ b04074de3bf8 Pull complete                                            0.7s
   ✔ 9bb6878453a5 Pull complete                                            0.6s
   ✔ 6d5f17073618 Pull complete                                            1.0s
   ✔ cd40b8e90ebf Pull complete                                            0.9s
   ✔ ba9996723a9e Pull complete                                            2.6s
   ✔ 68b2f785e194 Pull complete                                            1.3s
[+] Running 2/2
 ✔ Network website_default       Created                                   0.3s
 ✔ Container website-electric-1  Created                                   0.2s
Attaching to website-electric-1
website-electric-1  | 15:44:11.605 pid=<0.2309.0> [notice]     :alarm_handler: {:set, {:system_memory_high_watermark, []}}
website-electric-1  | 15:44:11.614 pid=<0.2453.0> [info] Running Electric.Plug.Router with Bandit 1.0.0-pre.14 at 0.0.0.0:5133 (http)
website-electric-1  | 15:44:11.615 pid=<0.2768.0> origin=postgres_1 [info] connect: %{database: ~c"postgres", host: ~c"db.imeponfqpunqpyzgazjd.supabase.co", ipv6: false, port: 5432, ssl: false, timeout: 5000, username: ~c"postgres"}
website-electric-1  | 15:44:17.235 pid=<0.2768.0> origin=postgres_1 [info] Successfully initialized origin postgres_1 at extension version
website-electric-1  | 15:44:17.236 pid=<0.2773.0> [info] Starting Proxy server listening at port 65432
website-electric-1  | 15:44:17.237 pid=<0.2774.0> pg_producer=postgres_1 [info] Starting Elixir.Electric.Postgres.Extension.SchemaCache for postgres_1
website-electric-1  | 15:44:17.237 pid=<0.2774.0> pg_producer=postgres_1 [warning] SchemaCache "postgres_1" registered as the global instance
website-electric-1  | 15:44:17.238 pid=<0.2777.0> [info] Starting replication from postgres_1
website-electric-1  | 15:44:17.238 pid=<0.2777.0> [info] Connection settings: %{database: ~c"postgres", host: ~c"db.imeponfqpunqpyzgazjd.supabase.co", ipv6: false, password: ~c"******", port: 5432, replication: ~c"database", ssl: false, timeout: 5000, username: ~c"postgres"}
website-electric-1  | 15:44:19.969 pid=<0.2780.0> pg_producer=postgres_1 [info] Starting Elixir.Electric.Replication.Postgres.MigrationConsumer using Elixir.Electric.Postgres.Extension.SchemaCache backend
website-electric-1  | 15:44:20.905 pid=<0.2768.0> origin=postgres_1 [info] successfully initialized connector "postgres_1"
```

The following HTTP endpoint can be used to verify that Electric has an active replication connection to Postgres. You may use it as a health check for the service.

```shell
$ curl http://167.99.132.206/api/status
Connection to Postgres is up!
```

Unlike the DigitalOcean app we deployed above which could only listen on standard HTTP/HTTPS ports, a Droplet is just a virtual server that may have any number of ports open. This allows us to connect to the Electric proxy directly without having to run a local tunnel:

```shell
$ psql postgresql://postgres:******@167.99.132.206:65432/postgres
psql (15.4, server 15.1 (Ubuntu 15.1-1.pgdg20.04+1))
Type "help" for help.

[167] postgres:postgres=>
```

### Running the basic example app

Let's see how to set up a client app to connect to the Electric sync service we've just deployed. Clone the source code repository to your machine and navigate to the basic example, as explained on [this page](../../examples/basic#source-code).

#### Apply migrations

Electric can work alongside any tooling you use to manage database migrations with. See the <DocPageLink path="integrations/backend" /> section of the docs for an overview of the most popular frameworks. In this demo we'll use `@databases/pg-migrations` as it's already included in the basic example. Make sure you have installed all of the dependencies by running `yarn` once.

Export an environment variable `PG_PROXY_PASSWORD` on your local machine before running the commands below, use the same value as the one configured for the DigitalOcean app:

```shell
export PG_PROXY_PASSWORD=...
```

Run `npx pg-migrations apply` to apply the migration included in the example to your database via the migrations proxy:

```shell
$ npx pg-migrations apply \
      --directory db/migrations \
      --database postgresql://postgres:$PG_PROXY_PASSWORD@167.99.132.206:65432/postgres
Applying 01-create_items_table.sql
Applied 01-create_items_table.sql
1 migrations applied
```

#### Generate a type-safe client

Now that the database has one electrified table, we can [generate a type-safe client](../../usage/data-access/client.md) from it. Use the same database connection URL as in the previous step but change the username to `prisma` (this is required for the schema introspection to work correctly).

```shell
$ npx electric-sql generate \
      --service http://167.99.132.206 \
      --proxy postgresql://prisma:$PG_PROXY_PASSWORD@@167.99.132.206:65432/postgres
Generating Electric client...
Successfully generated Electric client at: ./src/generated/client
Building migrations...
Successfully built migrations
```

#### Start the app!

Now you should have everything ready to start the web app and have it connected to the Electric sync service running on a DigitalOcean Droplet:

```shell
$ ELECTRIC_URL='ws://167.99.132.206' \
  SERVE=true \
  npm run build

> electric-sql-wa-sqlite-example@0.7.0 build
> node copy-wasm-files.js && node builder.js

Your app is running at http://localhost:3001
```
