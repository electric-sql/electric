---
title: Adonis JS
description: >-
  A fully featured web framework for Node.js
sidebar_position: 71
---

## Migrations

Use the [`raw` method on the `Schema Builder`]([https://laravel.com/docs/10.x#databases-and-migrations](https://docs.adonisjs.com/reference/database/schema-builder#raw)).

First, create a migration:

```shell
node ace make:migration electrify_items
```

Then use `this.schema.raw` in the `up` function:

```javascript
import BaseSchema from '@ioc:Adonis/Lucid/Schema'

export default class extends BaseSchema {

  public async up () {
    this.schema.raw("ALTER TABLE items ENABLE ELECTRIC")
  }

}

```
