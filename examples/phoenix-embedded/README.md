# Embedded Electric Example

This is a simple Phoenix application showing how you can embed and Electric
instance into your Elixir application to provide seamless client syncing with
all the benefits of Phoenix as a backend server.

## Integration

1\. Add `:electric` as a dependency to your Phoenix application:

```elixir
# mix.exs

def deps do
  [
    # .. standard phoenix dependencies
    {:electric, ">= 1.0.0-beta.18"}
  ]
end
```

**2\. Configure Electric**

Configure Electric to connect to your Postgres database and run in embedded
mode without its own HTTP server implementation:

```elixir
# config/dev.exs

# share the Postgres connection information between the Ecto Repo and ELectric
# We will
connection_opts = [
  username: "postgres",
  password: "postgres",
  hostname: "localhost",
  database: "postgres",
  port: 5432
]

# Configure your database
config :my_app,
       MyApp.Repo,
       Keyword.merge(
         connection_opts,
         stacktrace: true,
         show_sensitive_data_on_connection_error: true,
         pool_size: 10
       )
# ...

config :electric,
  enable_http_api: false,
  connection_opts: connection_opts,
  # In dev we don't persist shape information between app restarts
  storage_dir: Path.join(System.tmp_dir!(), "electric/phoenix_embedded#{System.monotonic_time()}")
```

3\. **Add a route to expose your table as an Electric Shape to the frontend**

```elixir
# lib/my_app_web/router.ex

defmodule MyApp.Router do
  use MyAppWeb, :router

  import Electric.Phoenix.Router

  # ... standard phoenix pipelines and routes

  pipeline :electric do
    # put whatever authentication plugs you want in here
  end

  scope "/shapes" do
    pipe_through :electric

    # Expose the "todos" table as a shape
    shape "/todos"
  end
end
```

The `shape/2` router macro accepts various options. The version above infers
the table name from the path, but you can also path the table name explicitly
and include any [where clauses](https://electric-sql.com/docs/guides/shapes#where-clause):

```elixir
defmodule MyApp.Router do
  import Electric.Phoenix.Router
  # ...
  scope "/shapes" do
    pipe_through :electric

    shape "/completed-todos",
      table: "todos",
      where: "completed = true"
  end
end
```

Or even use an Ecto query:

```elixir
defmodule MyApp.Router do
  # ...
  import Electric.Phoenix.Router

  require Ecto.Query

  scope "/shapes" do
    pipe_through :electric

    shape "/todos", MyApp.Todos.Todo

    shape "/completed-todos",
      Ecto.Query.from(t in MyApp.Todos.Todo, where: t.completed == true)
  end
end
```

See the `Electric.Phoenix.Router` docs for more examples.

4\. **Use the Electric Typescript client to sync your shape to the browser**

```typescript
import { ShapeStream, Shape } from "@electric-sql/client"

const stream = new ShapeStream({
  // resolve the URL relative to the current page
  url: new URL(`/shapes/todos`, window.location.href).href,
})

const shape = new Shape(stream)

// The callback runs every time the Shape data changes.
shape.subscribe((data) => console.log(data))
```

See the [Electric documentation](https://electric-sql.com/docs/api/clients/typescript)
for more information.

## Phoenix Set up

To start your Phoenix server:

- Run `mix setup` to install and setup dependencies
- Start Phoenix endpoint with `mix phx.server` or inside IEx with `iex -S mix phx.server`

Now you can visit [`localhost:4000`](http://localhost:4000) from your browser.

Ready to run in production? Please [check our deployment guides](https://hexdocs.pm/phoenix/deployment.html).

## Learn more

### Electric

- Official website: <https://electric-sql.com/>
- Documentation: <https://electric-sql.com/docs/intro>

### Phoenix

- Official website: <https://www.phoenixframework.org/>
- Guides: <https://hexdocs.pm/phoenix/overview.html>
- Docs: <https://hexdocs.pm/phoenix>
- Forum: <https://elixirforum.com/c/phoenix-forum>
- Source: <https://github.com/phoenixframework/phoenix>
