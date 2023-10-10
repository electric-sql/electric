# DDLX

There are three distinct bits inside the module Electric.DDLX:

- sql
- parse
- commands


### sql

The SQL statements that install DDLX tables and functions into Postgres. They are actually in a single file in `sql/init_ddlx.sql`.

You can use this on its own without `parse` or `commands` if you want. They are really just utilities to help call the sql.

You can also get them from `Electric.DDLX.init_statements()` as a list of strings.

Running these statements will:

- install uuid-ossp
- ensure there is an `electric` schema  
- create 3 new DDLX tables
    - `electric.grants`
    - `electric.roles`
    - `electric.assignments`
- add 7 new DDLX functions    
    - `electric.enable`
    - `electric.disable`
    - `electric.assign`
    - `electric.unassign`
    - `electric.grant`
    - `electric.revoke`
    - `electric.sqlite`
- and 3 utility functions that it uses internally
    - `electric.find_pk`
    - `electric.find_fk_for_column`
    - `electric.find_fk_to_table`
    
### commands

These are a set of structs, one for each of the DDLX Postgres functions, that have the common method `pg_sql` which will
return a SQL statment string to call its function.

This can be accessed through `Electric.DDLX.command_to_postgres()`

### parse

These are a set of parsers that read DDLX's extended PostgreSQL language statements and return command structs.

See [https://github.com/electric-sql/docs/blob/main/documentation/docs/api/ddlx.mdx]() for the syntax of DDLX that they read.

This is WIP and not everything works yet.

This can be accessed through `Electric.DDLX.ddlx_to_commands()`.

These is also an extra utility function `Electric.DDLX.is_ddlx()` to help check if a SQL statement is actually a DDLX statement.

## Functions internals


### electric.enable
Calls the electric.electrify() procedure on the target table.

### electric.disable
currently does nothing - is the new 'unelectrify'

### electric.assign
Adds a new entry to the `electric.assignments` and creates a set of resources used by the assignment:

- 1 x join table
- 2 x functions 
- 3 x triggers

When a table referenced by the assignment is created or modified the triggers run a function that both updates the join table
and writes the role into the `electric.roles` table.

The row in the join table has foreign keys to:

- The user.
- The row that triggered the role to be assigned.
- The row in `electric.assignments` it belongs to.
- The row in the scope table, if one is provided.
- The row in `electric.roles`

It uses these to clean up nicely.

### electric.unassign

Undoes all the work of a corresponding call to `electric.assign`

### electric.grant

Adds entries to the `electric.grants` table

### electric.revoke

Removes entries from the `electric.grants` table

### electric.sqlite

currently does nothing



