---
title: Laravel
description: >-
  The PHP framework for web artisans.
sidebar_position: 20
---

## Migrations

### Proxying

To run your migrations [through the proxy](../../usage/data-modelling/migrations.md#migrations-proxy) copy your `.env` file to `.env.proxy` and edit the database settings:

```shell
DB_CONNECTION=pgsql

# Database name is ignored.
DB_DATABASE=postgres

# User is normally `electric`.
DB_USERNAME=electric
# Password is the password you configure using `PG_PROXY_PASSWORD`
# when running the Electric sync service.
DB_PASSWORD=postgres

# Host is the hostname where you're running Electric.
DB_HOST=localhost
# Port is the `PG_PROXY_PORT` you set when running Electric,
# which defaults to 65432.
DB_PORT=65432
```

Then set the `APP_ENV` to `proxy` when running migrations, e.g.:

```shell
APP_ENV=proxy php artisan migrate
```

### Applying DDLX statements

Use the [`statement` method on the `DB` facade](https://laravel.com/docs/10.x#databases-and-migrations).

First, create a migration:

```shell
php artisan make:migration electrify_items
```

Then use `DB::statement` in the `up` function:

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration {
  public function up(): void {
    DB::statement("ALTER TABLE items ENABLE ELECTRIC");
  }
};
```
