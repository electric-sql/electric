# The Next Electric

### Notes

- Test table SQL — https://github.com/KyleAMathews/http-sync-prototype/tree/main/test-electric-instance/db/migrations
- TODO table SQL — https://github.com/KyleAMathews/http-sync-prototype/blob/main/todomvc/db/migrations/001-create-todos.sql

Tests are at `index.test.ts`. You run them by running in terminal: `npx vitest`. Tests have to be run in sequence to work (not ideal) and to only run the first one, change the function from `it(` to `it.only(`

`afterAll` is the vitest hook for running cleanup code when the tests are done. Right now it deletes test data in postgres. While working on the Electric server, this would be the place to do any cleanup neccessary there.

## Clients & integrations

- js client @ client.ts
- bash client @ bash-client.bash
- redis integration @ redis.ts
- React hook `useShape` @ use-shape.ts

## Setting up your development environment
We're using [asdf](https://asdf-vm.com/) to install Elixir, Erlang, and Node.js.

### Mac setup
1. `brew install asdf`
2. `asdf plugin-add nodejs elixir erlang`
3. `asdf install`

You'll probably need to fiddle with your bash/zsh/etc rc file to load the right tool into your environment.
