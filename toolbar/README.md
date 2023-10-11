<a href="https://electric-sql.com">
  <picture>
    <source media="(prefers-color-scheme: dark)"
        srcset="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-light-trans.svg"
    />
    <source media="(prefers-color-scheme: light)"
        srcset="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-black.svg"
    />
    <img alt="ElectricSQL logo"
        src="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-black.svg"
    />
  </picture>
</a>

# ElectricSQL - Developer Toolbar

These are a collection of tools that can be used by developers to help them debug their ElectricSQL apps

## Adding this toolbar to your project

Add the toolbar to your project's `devDependencies` in `package.json`

```sh
  "devDependencies": {
    ...
    "@electric-sql/debug-toolbar": "latest",
    ...
    }
```

In your code add the toolbar after initialising the electric database.

First some imports:

```typescript
// toolbar imports
import { globalRegistry } from "electric-sql/satellite";
import addToolbar, { typescriptApi } from '@electric-sql/debug-toolbar'
import '@electric-sql/debug-toolbar/dist/index.cjs.css'
```

Then add the toolbar after calling `electrify`:

```typescript
// Add the debug toolbar
addToolbar(typescriptApi(globalRegistry))
```

This will add the toolbar to the bottom of your window

## Development

To develop with the toolbar you will need a project with an ElectricSQL database added. 
You can use one of the example projects such as `examples/web-wa-sqlite`, 
but you will have to make a few changes to the project's configuration:

Add web-wa-sqlite to the pnpm workspace by adding this line to `pnpm-workspace.yaml`

```yaml
  - 'examples/web-wa-sqlite
```

Change the `web-wa-sqlite` dev dependencies in `Package.json` to use the local version of the 
toolbar rather than the published one and add a dependency on `zod`:

```json
  "devDependencies": {
    ...
    "@electric-sql/debug-toolbar":  "workspace:*",
    ...
    "zod": "^3.21.1"
  },
```
Run `pnpm install` in the root of this repo to install everthing.

Build the toolbar:

```json
cd toolbar
yarn build
```
Run the example:

```
cd ../examples/web-wa-sqlite
yarn build
yarn start
```

You sould now see the local version of the toolbar being used by the app. 
When you mofify the toolbar you will have to rebuild it for the changes to appear in the app.

