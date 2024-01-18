# create-electric-app

## 0.2.4

### Patch Changes

- 208dc52a: Update the create-electric-app starter to use Vite and our new CLI

## 0.2.3

### Patch Changes

- e11501d8: - Fix generator not cleaning up temporary migrations folder on error.
  - Add --debug flag to generator for option to retain migrations folder on error for inspection.
  - Add temporary migration folder to gitignore in starter template

## 0.2.2

### Patch Changes

- 071175d4: Improve Windows support

## 0.2.1

### Patch Changes

- a9bb17ca: Upgrade wa-sqlite version because of a critical bug fix in wa-sqlite.

## 0.2.0

### Minor Changes

- d109a1e7: Major new release that introduces Electric Postgres Proxy, affecting all Electric components.

### Patch Changes

- 23d84eb6: Update the `db:psql` script to connect to the database using `psql` running inside of the postgres container.

  This lifts the requirement of having a Postgres client installed on the host OS.

- e5fb598a: Expose port 65432 used by the proxy and make it configurable. Modify the migration machinery to go through the proxy. Modify the starter template to use the new `ALTER TABLE ... ENABLE ELECTRIC` syntax.
- cfded697: Modify CLI to introspect Postgres database through Electric's proxy.
- dc1c576e: The starter app can now have multiple migrations and applying them with `yarn db:migrate` is now idempotent.
- 0d879a88: Improved starter such that several (independent) Electric projects can run concurrently.
  The starter now has 2 modes: fast mode and interactive mode.
  In fast mode, you can provide the app name and optional ports for Electric and the webserver as arguments.
  In interactive mode, the script will prompt for an app name and ports (suggesting defaults).
  Port clashes are now detected and reported to the user.
  The user can change the ports the app uses by invoking 'yarn ports:configure'.
  Also fixes the bug where all Electric applications would forward requests to the esbuild server that is running on port 8000 instead of their own esbuild server.

## 0.1.6

### Patch Changes

- a42ee2c: Pull latest Electric and TS dependencies in starter and freeze them.

## 0.1.5

### Patch Changes

- bec4399: Remove NodeJS --no-warnings flag

## 0.1.3

### Patch Changes

- a05c04d: Add missing `typescript` devDependency to fix package build.

## 0.1.2

### Patch Changes

- 7cc6e27: Use correct version of `electric-sql` on the starter template

## 0.1.1

### Patch Changes

- 1c20e29: Improve starter template output and introduced new db:connect command.
- d9344b9: Use a tab scoped dbName so the starter example syncs across tabs.
- 345cfc6: Added auth.insecureAuthToken function and updated examples to use it.
- 29c7cc3: Starter template for bootstrapping Electric applications.
- 158431b: Include template in packaged files

## 0.1.1-next.2

### Patch Changes

- d9344b9: Use a tab scoped dbName so the starter example syncs across tabs.
- 345cfc6: Added auth.insecureAuthToken function and updated examples to use it.

## 0.1.1-next.1

### Patch Changes

- 1c20e29: Improve starter template output and introduced new db:connect command.
- 158431b: Include template in packaged files

## 0.1.1-next.0

### Patch Changes

- 29c7cc3: Starter template for bootstrapping Electric applications.
