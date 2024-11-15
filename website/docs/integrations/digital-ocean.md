---
outline: deep
title: Digital Ocean - Integrations
description: >-
  How to deploy Electric on Digital Ocean.
image: /img/integrations/electric-digital-ocean.jpg
---

<img src="/img/integrations/digital-ocean.svg" class="product-icon" />

# Digital Ocean

Digital Ocean is a cloud hosting platform.

## Electric and Digital Ocean

You can use Digital Ocean to deploy any or all components of the Electric stack:

- [deploy a Postgres database](#deploy-postgres)
- [an Electric sync service](#deploy-electric)
- [your client application](#deploy-your-app)

If you already run a Managed Postgres in Digital Ocean, then it's a great idea to also deploy Electric within the same network.

> [!Tip] Need context?
> See the [Deployment guide](/docs/guides/deployment) for more details.

### Deploy Postgres

Digital Ocean provides [Managed Postgres](https://docs.digitalocean.com/products/databases/postgresql/). This has logical replication enabled and works with Electric out of the box.

> [!Tip] Use <code>doadmin</code> for older Postgres versions
> If you're using Postgres version 15 or lower, you will need to connect to your Managed Postgres as the `doadmin` user. This is the default user and the only user with the `REPLICATION` role.
>
> (With later Postgres versions its fine to create other users and use the `doadmin` user to grant them the `REPLICATION` role).

### Deploy Electric

Digital Ocean has a number of different ways to deploy web services. We recommend using a [Docker Droplet](https://marketplace.digitalocean.com/apps/docker).

Below we walk through the steps to deploy Electric using a Docker Droplet. First you create the Droplet. Then setup some Docker / SSH networking so your local Docker can talk to it. Then use Docker Compose to run Electric inside the Droplet.

> [!Warning] Don't use App Platform
> We **don't recommend** that you use [App Platform](https://docs.digitalocean.com/products/app-platform/) to deploy the Electric sync service because App Platform does not provide persistent file storage for Shape logs.

#### Create Droplet

Go to the [Docker marketplace page](https://marketplace.digitalocean.com/apps/docker) and click on the "Create Docker Droplet" button. Follow the prompts. You **must** use key-based SSH authentication (so that you can set up your local Docker to talk to the remote daemon). It's a good idea to change the hostname to something like `electric-sync` as well.

Create the Droplet and wait until its ready with an IPv4 address. Copy the address and use it in place of `YOUR_IP_ADDRESS` in the instructions that follow.

#### Connect Docker

Connect to your new Droplet using `ssh` in order to verify the authenticity of the host and add its public key to your local `known_hosts` file.

```console
$ ssh root@YOUR_IP_ADDRESS
...
Are you sure you want to continue connecting (yes/no/[fingerprint])? yes
Warning: Permanently added 'YOUR_IP_ADDRESS' (ED25519) to the list of known hosts.
```

> [!Warning] Permission denied?
> If the output from the command above ends with:
>
>     ... Permission denied (publickey).
>
> Then you need to add a section to your `~/.ssg/config` to tell it to use your SSH key
> when connecting to `YOUR_IP_ADDRESS`. Something like this will do:
>
> ```
> Host YOUR_IP_ADDRESS
>   Port 22
>   Hostname YOUR_IP_ADDRESS
>   AddKeysToAgent yes
>   IdentitiesOnly yes
>   IdentityFile ~/.ssh/path_to_your_private_ssh_key
>   TCPKeepAlive yes
>   UseKeychain yes
> ```

Now set the `DOCKER_HOST` environment variable to point to your Droplet's IP address:

```shell
export DOCKER_HOST=ssh://root@YOUR_IP_ADDRESS
```

#### Deploy

Save the following contents into a file called `compose.yaml`, changing the `DATABASE_URL` and setting [any other environment variables](/docs/api/config) to match your setup.

```yaml
services:
  electric:
    image: electricsql/electric:latest
    environment:
      DATABASE_URL: "postgresql://..."
    ports:
      - 80:3000
    restart: always
```

Now launch on the remote server, with output that should look something like this:

```console
$ docker compose up
[+] Running 8/8
 ✔ electric 7 layers [⣿⣿⣿⣿⣿⣿⣿]      0B/0B      Pulled      8.2s
   ✔ efc2b5ad9eec Pull complete                             3.4s
   ✔ 2cb0d575dcef Pull complete                             4.5s
   ✔ c1b251d76665 Pull complete                             4.6s
   ✔ c82981779fd9 Pull complete                             4.7s
   ✔ 65b429e477c5 Pull complete                             4.8s
   ✔ 1fd7ee9efb04 Pull complete                             6.0s
   ✔ 87053f06541e Pull complete                             6.1s
[+] Running 2/2
 ✔ Network electric-sync-droplet_default       Created      0.2s
 ✔ Container electric-sync-droplet-electric-1  Created      0.2s
Attaching to electric-sync-droplet-electric-1
electric-sync-droplet-electric-1  | =INFO REPORT==== 23-Oct-2024::13:16:01.777082 ===
electric-sync-droplet-electric-1  | Loading 140 CA(s) from otp store
electric-sync-droplet-electric-1  | 13:16:01.832 [info] Running Electric.Plug.Router with Bandit 1.5.5 at 0.0.0.0:3000 (http)
electric-sync-droplet-electric-1  | 13:16:01.935 [info] Acquiring lock from postgres with name electric_slot_default
electric-sync-droplet-electric-1  | 13:16:01.937 [info] Lock acquired from postgres with name electric_slot_default
electric-sync-droplet-electric-1  | 13:16:02.006 [info] Postgres server version = 160004, system identifier = 7428958789530034185, timeline_id = 1
electric-sync-droplet-electric-1  | 13:16:02.145 [info] No previous timeline detected.
electric-sync-droplet-electric-1  | 13:16:02.146 [info] Connected to Postgres  and timeline
electric-sync-droplet-electric-1  | 13:16:02.147 [info] Starting shape replication pipeline
electric-sync-droplet-electric-1  | 13:16:02.150 [info] Starting replication from postgres
```

You can hit the health check endpoint to verify that everything is running OK:

```console
$ curl http://YOUR_IP_ADDRESS/v1/health
{"status":"active"}
```

### Deploy your app

You can deploy [your client app to Digital Ocean using App Platform](https://www.digitalocean.com/community/tutorials/how-to-deploy-a-static-website-to-the-cloud-with-digitalocean-app-platform).