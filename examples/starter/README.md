
# ElectricSQL Starter

This is a starter app template. You can use it to generate an ElectricSQL application. The app is setup to match the example code you can see in the [Quickstart](https://electric-sql.com/docs/quickstart).

## Pre-reqs

- Docker (with Compose V2)
- Node >= 16.11.0

## Usage

```sh
npx create-electric-app@latest my-app
```

Change directory into the created folder (`./my-app` in the example command above) and then follow the instructions in the generated README.

You can optionally pass the following arguments to the `create-electric-app` command to configure the app.

| Argument              | Value                   | Default   | Description
|-----------------------|-------------------------|-----------|--------------
| `--template`          | `'react' \| 'vue'`      | `'react'` | Starter template to use
| `--electricPort`      | `0 - 65535`             | `5133`    | Port on which to run Electric
| `--electricProxyPort` | `0 - 65535`             | `65432`   | Port on which to run Electric's DB proxy

