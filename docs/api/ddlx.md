---
title: DDLX
description: >-
  Database rules to control what data is allowed to sync where. 
sidebar_position: 10
---

ElectricSQL extends the PostgreSQL language with the following DDLX statements.

Use these in your [migrations](../usage/data-modelling/migrations.md) to [electrify tables](../usage/data-modelling/electrification.md) and expose data by granting [permissions](../usage/data-modelling/permissions.md) to roles and assigning roles to [authenticated](../usage/auth/index.md) users.

:::caution Work in progress
The syntax and features described in this page are not fully implemented. There are some notes below on which parts are not implemented yet. 
See [Roadmap -> DDLX rules](../reference/roadmap.md#ddlx-rules) for more context.
:::

## Electrification

Tables must be [electrified](../usage/data-modelling/electrification.md) to include them in the replication machinery.

### `ENABLE`

Enables electric for a Postgres table. Aka "electrifies" the table.

```sql
ALTER TABLE table_name
  ENABLE ELECTRIC;
```

Makes the table `table_name` in Postgres available to Electric. Once you have electrified a table you can expose data in it using the [`GRANT`](#grant) and [`ASSIGN`](#assign) statements below.

#### Parameters

- **`table_name`** - the name of an existing table

#### Examples

This will electrify the `projects` table.

```sql
ALTER TABLE projects
  ENABLE ELECTRIC;
```

### `DISABLE`

Removes a Postgres table from Electric. Aka "unelectrify" the table.

```sql
ALTER TABLE table_name
  DISABLE ELECTRIC;
```

Removes the previously electrified table `table_name` from Electric.

The operation will fail if you have any roles, permissions or other rules defined on the table. It's your responsibility to remove those first before you unelectrify the table.

#### Parameters

- **`table_name`** - the name of an existing electrified table

#### Examples

This will disable replication for the `projects` table.

```sql
ALTER TABLE projects
  DISABLE ELECTRIC;
```

## Roles and permissions

All of Electric's permissions for users to read and write data are controlled through roles. First, permissions are granted to roles. Then roles are assigned to users.

See <DocPageLink path="usage/data-modelling/permissions" /> for more information.


### `GRANT`

Grants permissions to roles.

:::caution Work in progress
The column_name statement is not implemented yet, but is coming soon. 
We have included it here as it's helpful in explaining how the permissions will work overall.
:::

```sql
ELECTRIC GRANT
  { SELECT | INSERT | UPDATE | DELETE | READ | WRITE | ALL [ PRIVILEGES ] } [ ( column_name [, ...] ) ]
  ON [ TABLE ] table_name
  TO role
  [ WHERE ( check_expression )];
```

Where `role` is:

```sql
{ ( scope_table_name, 'role_name' )
  | { 'role_name' | AUTHENTICATED | ANYONE  }
}
```

Grants ones of these four permissions on the table `table_name` to the role `role_name`:

- `SELECT` - allows users to read the row
- `INSERT` - allows users to create a new row
- `UPDATE` - allows users to change the content of an existing row
- `DELETE` - allows users to delete an existing row

For convienence you can also use `ALL`, `READ`, and `WRITE` as aliases
for combinations of the four core permissions:

- `ALL` is an alias for `SELECT, INSERT, UPDATE, DELETE`
- `READ` is an alias for `SELECT`
- `WRITE` is an alias for `INSERT, UPDATE, DELETE`

You can grant a permission on a whole table or only on specific columns by giving one or more `column_name`.

This is very similar to the standard PostgreSQL `GRANT` for tables, but extends the syntax to give more fine grained control over who can do what. These are the main differences:

1. you can, optionally, define a scope in which the grant applies
2. you can add a `WHERE` constraint to make permissions dependent on the content of rows
3. the roles referred to are ElectricSQL specific role names rather than usual Postgres roles
4. these roles are assigned to users with the [`ASSIGN`](#assign) statement below
5. only four permissions (directly, or via their aliases) can be granted with this statement

The optional scope table `scope_table_name` may be the same table as `table_name` or another table. Using a scope lets you limit where this grant applies e.g. you can grant permissions on the content of a project to only admins of that specific project.

As well as role names you create, there are a couple of built-in roles automatically provided by ElectricSQL:

- `AUTHENTICATED`
- `ANYONE`

Users have a set of roles. Every user will have the `ANYONE` role and authenticated users will have the `AUTHENTICATED` role.

If you add a `WHERE` clause, then when the permission is used the `check_expression` will be evaluated against any existing row and any data being written. If it evaluates as false then the operation will fail.

The `check_expression` is a sql boolean expression. This function will have various pre-defined variables available to validate the action. 

- AUTH the auth state for the connection is available for every operation. Has the user_id which may be null defined by the authentication token and also the claims field which provides all the claims from the JWT. 
- NEW available for INSERT and UPDATE operations, NULL in DELETE operations
- OLD available for DELETE and UPDATE operations, NULL in INSERT operations
- ROW available for SELECT operations. 

:::note
If you have added additional claims to the authentication JWT then they can also be referenced in the `check_expression`. They are available at `auth.claims`.

This can be used to extend authorisation and provide additional discrimination between users that is not modelled in the data and hence not available to the `ASSIGN` mechanism. However, if possible, it is generally best to use `ASSIGN` rather than add complex extra claims to the JWT. This is because the state of the permissions via `ASSIGN` will be consistent with the contents of the database (i.e.: part of the same snapshot) whereas those in the JWT are tied to the lifecycle of the client's connection and are thus less responsive and not guaranteed to be consistent with the contents of the database.
:::

#### Parameters

- **`column_name`** - you can provide one or more column names that this permission will apply to.
If you don't give any column names then the grant applies to the whole table.
- **`table_name`** - the name of an existing electrified table table on which to grant the permission.
- **`role_name`** - the name of a role that has been assigned to users with an `ELECTRIC ASSIGN` statement.
- **`check_expression`** - a sql expression that will be evaluated when the permission is used

#### Examples

Grant all permissions on the `records` table to the global role of `'admin'`.

```sql
ELECTRIC GRANT ALL
  ON records 
  TO 'admin';
```

Grant read permissions on the whole `records` table and update permissions to just the `name` and `description` fields to the global `'reader'` role.

```sql
ELECTRIC GRANT SELECT
  ON records 
  TO 'reader';

ELECTRIC GRANT UPDATE (
    name, 
    description
  )
  ON records 
  TO 'reader';
```

This grant with a scope gives all permissions on the `projects` table to users who have the role `admin` for that project.

```sql
ELECTRIC GRANT ALL
  ON projects 
  TO (projects, 'admin');
```

This grant lets users who have the role `member` in a project read the project's issues. Here `project_id` refers to a column on the `issues` table that is a foreign key pointing to a project.

```sql
ELECTRIC GRANT READ
  ON issues
  TO (projects, 'member');
```

This is similar to the grant above. It lets a project member read comments on issues in a project, but the comments table doesn't itself have a foreign key pointing to the project so the `USING` parameter provides a path to where to find it.

```sql
ELECTRIC GRANT READ
  ON comments
  TO (projects, member');
```

Here an `admin` can add project members with any role to the `project_members` join table, but a member can only add people as `member` or `guest`. The `CHECK` statement limits what they can do.

```sql
ELECTRIC GRANT INSERT
  ON project_members
  TO (projects, 'admin');

ELECTRIC GRANT READ
  ON project_members
  TO (projects, 'member');

ELECTRIC GRANT INSERT
  ON project_members
  TO (projects, 'member')
  WHERE (
    NEW.role_name = 'member'
    OR NEW.role_name = 'guest'
  );
```

Here any authenticated user can create a new project if they correctly set the `owner_id` of the new project to their `user_id`:

```sql
ELECTRIC GRANT INSERT
  ON projects 
  TO AUTHENTICATED
  WHERE (
    NEW.owner_id = AUTH.user_id
  );
```

If you include column names for reading data it will filter the column values in the rows that are synced to devices, sending `null`s for the other columns.

```sql
ELECTRIC GRANT READ (
    title, 
    description
  ) 
  ON issues
  TO (projects, 'member');
```

#### Updating grants

The current grant state for a given permission, table and role is determined by the last `GRANT` command issued. Grants are not merged together.

For example, after this sequence of grant commands:

```sql
ELECTRIC GRANT READ ON issues TO (projects, 'member');
ELECTRIC GRANT READ ON comments TO (projects, 'member');
ELECTRIC GRANT READ (title, description, date) ON issues TO (projects, 'member');
ELECTRIC GRANT READ (title, status) ON issues TO (projects, 'member');
```

The `(projects, 'member')` role will have `READ` permissions to the entire `comments` table but only the `title` and `status` columns of `issues` (within the `projects` scope).

If you then ran `ELECTRIC GRANT READ ON issues TO (projects, 'member')` the access would again widen to all columns of `issues`.

The `WHERE` expression uses the same logic as the column specification, the last write for a specific permission, table and role tuple wins.

### `REVOKE`

Revokes previously granted permissions.

```sql
ELECTRIC REVOKE
  { SELECT | INSERT | UPDATE | DELETE | READ | WRITE | ALL [ PRIVILEGES ] }
  ON [ TABLE ] table_name
  FROM role;
```

Where `role` is:

```sql
{ ( scope_table_name, 'role_name' )
  | { 'role_name' | AUTHENTICATED | ANYONE  }
}
```

You can specify one of these permissions:

- `SELECT`
- `INSERT`
- `UPDATE`
- `DELETE`

Or you can use `ALL`, `READ` or `WRITE` as for [`GRANT`](#grant) above.

#### Parameters

- **`column_name`** The names of the columns you want to remove this permission for.
- **`table_name`** The name of the table you want to remove this permission for.
- **`role_name`** The name of a role that you want to remove this permission from.

#### Examples

This shows the granting and revoking of permissions using matching `GRANT` and `REVOKE` statements. Note the change of keyword from `TO` to `FROM`.

```sql
ELECTRIC GRANT ALL
  ON projects 
  TO (projects, 'admin');

ELECTRIC REVOKE ALL 
  ON projects 
  FROM (projects, 'admin');
```

As `ALL` acts as an alias for all the other permissions this will result in global `'admin'`s having the `INSERT`, `SELECT` and `UPDATE` permissions on the table `records`.

```sql
ELECTRIC GRANT ALL
  ON records 
  TO 'admin';

ELECTRIC REVOKE DELETE
  ON records 
  FROM 'admin';
```

Revocation works at the permissions level for a given table and role. Revoking e.g. `READ` from a table for a given role will remove that role's read access to the table, no matter what the column specification for the read was. The code below will completely remove `UPDATE` rights for the `admin` role.

```sql
-- grant partial update rights to `admin`s
ELECTRIC GRANT UPDATE (name) ON records TO 'admin';

-- remove update rights from admin
ELECTRIC REVOKE UPDATE ON records FROM 'admin';
```

### `ASSIGN`

Assigns a role to an [authenticated user](../usage/auth/index.md).

```sql
ELECTRIC ASSIGN role_definition
  TO table_name.user_fk
  [ IF if_statement ];
```

Roles are **not** assigned to normal PostgreSQL database users. Instead, they are assigned to your application's [authenticated end users](../usage/auth/index.md) by matching their `auth.user_id` with foreign keys in your data model.

Each assignment rule watches a table `table_name` that has a foreign key referencing your users table and assigns its `role_definition` to the user dynamically based on the database contents.

Basically, an assignment tells ElectricSQL where to read these roles from and who to give them to.

#### Role definitions

A role can either be global, one that applies to any data, or be scoped by a row in a table so that it applies only to data that has a relationship to that row. This allows you to define roles tied to rows in tables. For example, an `'admin'` of a project, or a `'member'` of a club.

The role can also either be static and explicitly given as a literal in the `ASSIGN` statement or
dynamically read from a column in the `table_name`.

##### Static role definitions

These are string literals either with or without a scope table.

- `'admin'` - global admin role
- `(projects, 'admin')` - project admin role, scoped to the `projects` table

##### Dynamic role definitions

These specify a database column to read the role value from, using tuple syntax where necessary to specify a scope table.

- `users.role_name` - read a global (unscoped) role name from the `users.role_name` column
- `(projects, memberships.role_name)` - read the role name from the `memberships.role_name` column and then concatenate with the `projects` scope

In the first example above the global role assigned will be read from the column `role_name` in the table `users`. In the second example the scoped role is read from the column `role_name` in the table `memberships` and then concatenated with the `projects` scope. So, for example, if the `memberships.role_name` column contained the string `'admin'` then the scoped role assigned would be equivalent to the literal `(projects, 'admin')`.

:::note
You can always use the longer syntax for role definitions if you prefer or are writing them programmatically.

- `'admin'` can be written as `(NULL, 'admin')`
- `users.role_name` can be written as `(NULL, users.role_name)`
:::

#### Parameters

- **`role_definition`** - the definition of a role as described above
- **`table_name`** - the name of an electrified table that holds the users foreign keys to assign roles to
- **`user_fk`** - the name of the column holding the foreign key of the users to be assigned the role
- **`if_statement`** - optionally add a statement that will be evaluated against the row in `table_name`. The assignment rule will only assign the role if it evaluates as true. This is useful to assign roles dependent on things like booleans or specific string values

#### Examples

Here users whose `auth.user_id` matches a value in the `user_id` column of any row in the `admin_users` table will be assigned a global `'admin'` role.

```sql
ELECTRIC ASSIGN 'admin'
  TO admin_users.user_id;
```

Here users are assigned global roles by reading from the `role` column of the table `user_roles`.

```sql
ELECTRIC ASSIGN user_roles.role_name
  TO user_roles.user_id;
```

Here users referred to by the column `user_id` in the join table `project_members` are assigned roles in the scope of the specific project.

```sql
ELECTRIC ASSIGN (
    projects, 
    project_members.role
  )
  TO project_members.user_id;
```

In this example above, `project_members` is assumed to have a unambiguous foreign key to the `projects` table. This allows ElectricSQL to assign the role to the correct project. I.e.: if you had the following entries in `project_members`:

```
postgres=> SELECT * FROM project_members;
-[ RECORD 1 ]------------------------------------
user_id    | 21ba776e-cced-46de-9bb7-631dc9043287
project_id | 059ddbfc-5765-433d-aa5a-49b6e2450edc
role       | admin
-[ RECORD 2 ]------------------------------------
user_id    | 8e98e683-5a97-48b7-862e-808baa5ebcea
project_id | 11ee554b-b5d6-44fe-9cbe-9f8c5bad6e68
role       | admin
```

Then the user with ID `21ba776e-cced-46de-9bb7-631dc9043287` would be granted admin on the project with ID `059ddbfc-5765-433d-aa5a-49b6e2450edc` but not on the project with ID `11ee554b-b5d6-44fe-9cbe-9f8c5bad6e68`.

In the next example, explicitly named roles are assigned to users using different fields on the same table.

```sql
ELECTRIC ASSIGN (deliveries, 'driver')
    TO deliveries.driver_id;

ELECTRIC ASSIGN (deliveries, 'customer')
    TO deliveries.customer_id;
```

Here users referred to by the column `user_id` in the table `user_permissions` are assigned the global role `record.reader` if the flag `can_read_records` in the table user_permissions is true.

```sql
ELECTRIC ASSIGN 'record.reader'
    TO user_permissions.user_id
    IF ( can_read_records );
```

You can also use an `IF` statement to assign named roles to specific value matches on the table.

```sql
ELECTRIC ASSIGN 'record.reader'
    TO record_permissions.user_id
    IF ( role = 'reader' );
```

### `UNASSIGN`

Removes a previously created assignment rule.

```sql
ELECTRIC UNASSIGN role_definition
    FROM table_name.user_fk;
```

This will remove the assignment rule created by a previous matching call to `ASSIGN`. This will remove any roles from users that were assigned by the assignment rule that is being deleted.

Apart from the `IF` clause, an `UNASSIGN` statement must match its the corresponding `ASSIGN` statement exactly otherwise it will not work.

#### Parameters

- **`role_definition`** - the definition of a role as described above
- **`table_name`** - the name of an electrified table to read the role assignment from
- **`user_fk`** - the name of the column holding the foreign key of the users to remove the role from

#### Examples

`UNASSIGN` statements must match their corresponding `ASSIGN` statements.

```sql
ELECTRIC ASSIGN project_members.role
  TO project_members.user_id;

ELECTRIC UNASSIGN project_members.role 
  FROM project_members.user_id;

ELECTRIC ASSIGN 'record.reader'
    TO user_permissions.user_id
    IF ( can_read_records );

ELECTRIC UNASSIGN 'record.reader'
    FROM user_permissions.user_id;
```

## Local migrations

:::caution Not implemented
The syntax and the overall design of local migrations described below is not yet implemented. This sections describes a planned feature that we intend to implement at some point in the future.
:::

The `SQLITE` statement provides a mechanism to run DDL statements directly on the local SQLite database. 

### `SQLITE`

Define SQL statements to run on the local embedded SQLite database.

```sql
ELECTRIC SQLITE 'sqlite_statements'
```

This will run the `sqlite_statements` on all clients without touching the central Postgres database. `sqlite_statement` can be any valid SQLite statement.

This allows you to propagate migrations to local devices and work around any mismatch in type or extension support between Postgres and SQLite. And you can create tables and other resources that exist only locally in SQLite and are not synchronised to Postgres.

#### Parameters

- **`sqlite_statement`** - a string holding a valid SQLite statements; separate multiple statements with `;` delimiters

#### Examples

```sql
-- use PG's dollar quoted strings to avoid having to escape single quotes in the SQLite statements
ELECTRIC SQLITE $sqlite$
    CREATE TABLE local_only (id TEXT PRIMARY KEY);
  $sqlite$;
```
