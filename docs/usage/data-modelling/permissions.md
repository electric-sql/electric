---
title: Permissions
description: >-
  How to authorise data access by authenticated clients.
sidebar_position: 60
---

import useBaseUrl from '@docusaurus/useBaseUrl'

Once you've [electrified](./electrification.md) a table, you can grant and assign permissions to read and write the data in it using the [`GRANT`](../../api/ddlx.md#grant) and [`ASSIGN`](../../api/ddlx.md#assign) DDLX statements.

:::caution Work in progress
Permissions are not yet implemented. See the [Roadmap](../../reference/roadmap.md#ddlx-rules) for more information.
:::

## 1. Grant permissions to roles

Grant **permissions** to **roles** using the [`GRANT`](../../api/ddlx.md#grant) statement.

In the example below, we grant `ALL` permissions on projects to the project owner and `SELECT` permissions to the project members:

```sql
ELECTRIC GRANT ALL
  ON projects
  TO 'projects:owner';

ELECTRIC GRANT SELECT
  ON projects
  TO 'projects:member';
```

See <DocPageLink path="api/ddlx" /> for more details on how to grant and revoke permissions.

## 2. Assign roles to users

Assign **roles** to **users** using the [`ASSIGN`](../../api/ddlx.md#assign) statement.

In the example below, we assign the role of project owner to the user whose [authenticated `user_id`](../auth/index.md) matches the project's `owner_id` column. And we use a join table of `project_memberships` to assign the role of project member.

```sql
ELECTRIC ASSIGN 'projects:owner'
  TO projects.owner_id;

ELECTRIC ASSIGN 'projects:member'
  TO project_memberships.user_id;
```

Notice the different syntax for a role and a column. There are a [number of ways of defining roles](../../api/ddlx#role-definitions). Here they're defined using a string literal with a `:` as a delimiter. This indicates that the role is scoped to the projects table and is assigned on a row-level basis.

Also note that there is an inferred foreign key relationship between the `project_memberships` table and the `projects` table. (This can be specified explicitly `[ USING <scope path>]` when ambiguous).

What we get as a result is a highly flexible, dynamic, row-level security system that builds on the structure and contents of your existing data model.

See <DocPageLink path="api/ddlx" /> for more details on how to assign and unassign roles to users.

## Permission scopes

One of the powerful things about ElectricSQL is the ability to define [Shapes of data](../data-access/shapes.md) that sync as a unit onto the local device.

For example, you can choose to sync a project with all its issues and comments:

```tsx
await db.projects.sync({
  where: {
    id: 'abcd'
  },
  include: {
    issues: {
      include: {
        comments: {
          author: true
        }
      }
    }
  }
})
```

With this, it would be tedious to have to define roles on each of the tables in order to assign permissions to access the data. What you really want is to define a role at the top level -- like a project owner or member -- and then to have that role cascade down to, or be inherited by, the content that's coming in underneath the project as part of the shape.

That's what **permission scopes** are for. They simplify your access rules in a way that maps to the structure of your shapes:

```sql
ELECTRIC GRANT ALL
  ON issues
  TO 'projects:owner';

ELECTRIC GRANT ALL
  ON comments
  TO 'projects:owner'
  USING issue_id/project_id;

ELECTRIC GRANT READ
  ON users
  TO 'projects:owner'
  USING comment_author_fkey/issue_id/project_id;
```

Here the first statement assumes an unambiguous foreign key path between the `issues` and `projects` tables. The second statement demonstrates explicitly specifying the foreign key traversal path. The third demonstrates specifying part of the scope path using a named fkey (the `comment_author_fkey`, which belongs to the `comments` table not the `users` table).

## Directionality

Whilst your overall Postgres data model is often a cyclical graph (with multiple relationship pathways between tables), permission scopes must be **directed** and **acyclical**. In this regard, scopes are the same as [Shapes](../data-access/shapes.md) which are also directed and acyclical. The difference between the two is that:

- **scopes** are used database-side to control which data users are **allowed** to sync
- **shapes** are used client-side to control which data is **actually** synced

When a shape subscription is established, the shape provides the actual traversal hierarchy through which permissions are looked up. For data access to be authorised, this traversal hierarchy must map to a predefined permission scope.

<figure className="tile w-full m-0">
  <a href={useBaseUrl('/img/diagrammes/permission-scopes.pdf')} target="_blank">
    <span className="relative block">
      <img src={useBaseUrl('/img/diagrammes/permission-scopes.png')}
          alt="Diagramme illustrating permission scopes"
          loading="lazy"
      />
    </span>
  </a>
  <figcaption className="text-small text-right">
    Diagramme illustrating permission scopes. (1) shows a full data model with cyclical relationships. (2) shows a permission scope with role assignments (3) shows a shape-defined traversal hierarchy and (4) shows how authorisation is applied to the reads in the replication stream.
  </figcaption>
</figure>

## More information

See <DocPageLink path="api/ddlx" /> specification for more details.
