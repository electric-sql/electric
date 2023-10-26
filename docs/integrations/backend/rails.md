---
title: Rails
description: >-
  Full-stack framework for database-backed web applications in Ruby.
sidebar_position: 50
---

## Migrations

### Proxying

To run your migrations [through the proxy](../../usage/data-modelling/migrations.md#migrations-proxy) set `DATABASE_URL` to connect to the proxy when running migrations, e.g.:

```shell
DATABASE_URL=postgresql://electric:$PG_PROXY_PASSWORD@localhost:$PG_PROXY_PORT/mydb rake db:migrate
```

### Applying DDLX statements

With [Rails](../../integrations/backend/rails.md) you can `execute` SQL in the [`change` method](https://guides.rubyonrails.org/active_record_migrations.html#using-the-change-method) of your migration class.

First, create a migration:

```shell
rails generate migration ElectrifyItems
```

Then e.g.:

```ruby
class ElectrifyItems < ActiveRecord::Migration[7.0]
  def change
    execute "ALTER TABLE items ENABLE ELECTRIC"
  end
end
```
