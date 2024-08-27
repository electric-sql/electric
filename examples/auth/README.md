# Auth example

Example showing how an API can proxy shape requests and authenticate the client
and either deny access, give full access, or modify the shape request (in this
case, by adding a where clause) so the client sees only data they have permission
to see.

https://github.com/user-attachments/assets/eab62c23-513c-4ed8-a6fa-249b761f8667

## Setup

1. Make sure you've installed all dependencies for the monorepo and built packages

From the root directory:

- `pnpm i`
- `pnpm run -r build`

2. Start the docker containers

`pnpm run backend:up`

3. Start the dev server

`pnpm run dev`

4. When done, tear down the backend containers so you can run other examples

`pnpm run backend:down`
