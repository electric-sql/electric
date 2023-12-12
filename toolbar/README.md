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

First some imports 

```typescript
import { addToolbar } from '@electric-sql/debug-toolbar'
import '@electric-sql/debug-toolbar/dist/index.cjs.css'
```

Then in your code after calling `electrify` pass the electric client into addToolbar:

```typescript
const electricClient = await electrify(conn, schema, config)
addToolbar(electricClient)
```

This will add the toolbar to the bottom of your window




