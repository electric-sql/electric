---
title: Usage
description: How to use Electric Cloud
outline: deep
---

# Usage

Learn how to register your database and make API requests with Electric Cloud.

## Register your Database

1. Go to [Electric Cloud](https://dashboard.electric-sql.cloud) and log in.

2. Add a new database by clicking on [New Source](https://dashboard.electric-sql.cloud/sources/new).

3. Pick a region, team, and fill in your PostgreSQL connection string. Click the connect source button to connect your database to Electric Cloud.

Once connected you should see your source details.

<img alt="Source details in cloud dashboard" src="/static/img/docs/cloud/source-details.png" />

## Making API Requests

To request a shape you need to make an API request to `https://api.electric-sql.cloud/v1/shape`.
Don't forget to include the source credentials you obtained in the previous step.

Here is an example request using `curl`:

```shell
export SOURCE_ID="8ea4e5fb-9217-4ca6-80b7-0a97581c4c10"
export SECRET="<long secret value>"

export SHAPE_DEFINITION="table=items&offset=-1"

curl -i "https://api.electric-sql.cloud/v1/shape?$SHAPE_DEFINITION\
    &source_id=$SOURCE_ID\
    &secret=$SECRET"
```

## Security Model

The source ID is a key that uniquely identifies your Postgres database. The source secret is a token that grants access to it.

> [!Warning] Do not use your source secret in the client!
> If you use the source secret from a client, then this exposes it to malicious users.
>
> See the [security guide](/docs/guides/security) for more context.

### Proxy Auth

The recommended pattern is to add the source ID and secret parameter to the origin request made by your [auth proxy](/docs/guides/auth) or API.

See the [Cloud overview](/cloud/) for detailed examples.
