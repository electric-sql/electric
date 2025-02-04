defmodule Electric.Phoenix.Plug do
  @moduledoc """
  Provides an configuration endpoint for use in your Phoenix applications.

  Rather than configuring your [Electric Typescript
  client](https://electric-sql.com/docs/api/clients/typescript) directly, you
  instead configure a route in your application with a pre-configured
  `Electric.Client.ShapeDefinition` and then retreive the URL and other
  configuration for that shape from your client via a request to your Phoenix
  application.

  In your Phoenix application, [add a route](https://hexdocs.pm/phoenix/Phoenix.Router.html) to
  `Electric.Phoenix.Plug` specifying a particular shape:

      defmodule MyAppWeb.Router do
        scope "/shapes" do
          pipe_through :browser

          get "/todos", Electric.Phoenix.Plug,
            shape: Electric.Client.shape!("todos", where: "visible = true")
        end
      end

  Then in your client code, you retrieve the shape configuration directly
  from the Phoenix endpoint:

  ``` typescript
  import { ShapeStream } from '@electric-sql/client'

  const endpoint = `https://localhost:4000/shapes/todos`
  const response = await fetch(endpoint)
  const config = await response.json()

  // The returned `config` has all the information you need to subscribe to
  // your shape
  const stream = new ShapeStream(config)

  stream.subscribe(messages => {
    // ...
  })
  ```

  You can add additional authentication/authorization for shapes using
  [Phoenix's
  pipelines](https://hexdocs.pm/phoenix/Phoenix.Router.html#pipeline/2) or
  other [`plug`
  calls](https://hexdocs.pm/phoenix/Phoenix.Router.html#plug/2).

  ## Plug.Router

  For  pure `Plug`-based applications, you can use `Plug.Router.forward/2`:

      defmodule MyRouter do
        use Plug.Router

        plug :match
        plug :dispatch

        forward "/shapes/items",
          to: Electric.Phoenix.Plug,
          shape: Electric.Client.shape!("items")

        match _ do
          send_resp(conn, 404, "oops")
        end
      end

  ## Parameter-based shapes

  As well as defining fixed-shapes for a particular url, you can request
  shape configuration using parameters in your request:

      defmodule MyAppWeb.Router do
        scope "/" do
          pipe_through :browser

          get "/shape", Electric.Phoenix.Plug, []
        end
      end

  ``` typescript
  import { ShapeStream } from '@electric-sql/client'

  const endpoint = `https://localhost:4000/shape?table=items&namespace=public&where=visible%20%3D%20true`
  const response = await fetch(endpoint)
  const config = await response.json()

  // as before
  ```

  The parameters are:

  - `table` - The Postgres table name (required).
  - `namespace` - The Postgres schema if not specified defaults to `public`.
  - `where` - The [where clause](https://electric-sql.com/docs/guides/shapes#where-clause) to filter items from the shape.


  ## Custom Authentication

  The `Electric.Client` allows for generating authentication headers via it's
  `authenticator` configuration but if you want to include parameters from the
  request in the authentication tokens, for example including the currently
  logged in user id, then you can set an `authenticator` directly in the `Electric.Phoenix.Plug` configuration.

  First you must define a function that accepts the `%Plug.Conn{}` of the
  request, the `%Electric.Client.ShapeDefinition{}` of the endpoint and some
  (optional) config and returns a map of additional request headers:

      defmodule MyAuthModule do
        def shape_auth_headers(conn, shape, _opts \\\\ []) do
          user_id = conn.assigns.user_id
          signer = Joken.Signer.create("HS256", "my-deep-secret")
          claims = %{
            user_id: user_id,
            table: [shape.namespace, shape.table],
            where: shape.where
          }
          token = Joken.generate_and_sign!(Joken.Config.default_claims(), claims, signer)
          %{"authorization" => "Bearer \#{token}"}
        end
      end

  Now configure the Shape configuration endpoint to use your authentication function:

      forward "/shapes/tasks/:project_id",
        to: Electric.Plug,
        authenticator: {MyAuthModule, :shape_auth_headers, _opts = []},
        shape: [
          from(t in Task, where: t.active == true),
          project_id: :project_id
        ]


  Or you can use a capture:

      forward "/shapes/tasks/:project_id",
        to: Electric.Plug,
        authenticator: &MyAuthModule.shape_auth_headers/2,
        shape: [
          from(t in Task, where: t.active == true),
          project_id: :project_id
        ]
  """

  use Elixir.Plug.Builder, copy_opts_to_assign: :config

  alias Electric.Client.ShapeDefinition
  alias Electric.Phoenix.Gateway

  require Ecto.Query

  @valid_ops [:==, :!=, :>, :<, :>=, :<=]

  @type table_column :: atom()
  @type param_name :: atom()
  @type op :: :== | :!= | :> | :< | :>= | :<=
  @type conn_param_spec :: param_name() | [{op(), param_name()}]
  @type dynamic_shape_param :: {table_column(), conn_param_spec()} | table_column()
  @type dynamic_shape_params :: [dynamic_shape_param()]

  plug :fetch_query_params
  plug :shape_definition
  plug :return_configuration

  @doc false
  def init(opts) do
    shape_opts =
      case Keyword.get(opts, :shape) do
        nil ->
          %{}

        table_name when is_binary(table_name) ->
          %{shape: Electric.Client.shape!(table_name)}

        %ShapeDefinition{} = shape ->
          %{shape: shape}

        %Ecto.Query{} = query ->
          %{shape: Electric.Client.shape!(query)}

        schema when is_atom(schema) ->
          %{shape: Electric.Client.shape!(schema)}

        [query | opts] when is_struct(query, Ecto.Query) or is_atom(query) ->
          opts = validate_dynamic_opts(opts)
          %{shape: {:dynamic, query, opts}}
      end

    auth_opts =
      case Keyword.get(opts, :authenticator) do
        nil ->
          %{}

        {m, f, _a} = mfa when is_atom(m) and is_atom(f) ->
          %{authenticator: mfa}

        fun when is_function(fun, 2) ->
          %{authenticator: fun}

        invalid ->
          raise ArgumentError,
            message:
              ":authenticator expects {module, function, opts} or a 2-arity function, got: #{inspect(invalid)}"
      end

    # Unless the client is defined at compile time, unlikely in prod
    # environments because the app will probably be using configuration from
    # the environment, we need to use a function to instantiate the client at
    # runtime.
    %{client: Keyword.get(opts, :client, &Electric.Phoenix.client!/0)}
    |> Map.merge(shape_opts)
    |> Map.merge(auth_opts)
  end

  defp return_configuration(conn, _opts) do
    shape = conn.assigns.shape
    client = get_in(conn.assigns, [:config, :client]) |> build_client()
    send_configuration(conn, shape, client)
  end

  defp shape_definition(conn, opts)

  # the app has configured a fixed shape for the endpoint
  defp shape_definition(%{assigns: %{shape: %ShapeDefinition{}}} = conn, _opts) do
    conn
  end

  defp shape_definition(%{assigns: %{config: %{shape: %ShapeDefinition{} = shape}}} = conn, _opts) do
    assign(conn, :shape, shape)
  end

  defp shape_definition(%{assigns: %{config: %{shape: {:dynamic, query, opts}}}} = conn, _opts) do
    dynamic_shape(conn, query, opts)
  end

  defp shape_definition(%{query_params: %{"table" => table}} = conn, _opts) do
    case ShapeDefinition.new(table,
           where: conn.params["where"],
           namespace: conn.params["namespace"]
         ) do
      {:ok, shape} ->
        assign(conn, :shape, shape)

      {:error, error} ->
        halt_with_error(conn, Exception.message(error))
    end
  end

  defp shape_definition(conn, _opts) do
    halt_with_error(conn, "Missing required parameter \"table\"")
  end

  defp build_client(%Electric.Client{} = client) do
    client
  end

  defp build_client(client_fun) when is_function(client_fun, 0) do
    client_fun.()
  end

  defp halt_with_error(conn, status \\ 400, reason) when is_binary(reason) do
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(status, Jason.encode!(%{error: reason}))
    |> halt()
  end

  defp validate_dynamic_opts(opts) do
    Enum.map(opts, fn
      {column, param} when is_atom(param) ->
        {column, param}

      {column, [{op, param}]} when is_atom(param) and op in @valid_ops ->
        {column, {op, param}}

      column when is_atom(column) ->
        {column, column}
    end)
  end

  @doc """
  Defines a shape based on a root `Ecto` query plus some filters based on the
  current request.

      forward "/shapes/tasks/:project_id",
        to: Electric.Plug,
        shape: Electric.Phoenix.Plug.shape!(
          from(t in Task, where: t.active == true),
          project_id: :project_id
        )

  The `params` describe the way to build the `where` clause on the shape from
  the request parameters.

  For example, `[id: :user_id]` means that the `id` column on the table should
  match the value of the `user_id` parameter, equivalent to:

      from(
        t in Table,
        where: t.id == ^conn.params["user_id"]
      )

  If both the table column and the request parameter have the same name, then
  you can just pass the name, so:

      Electric.Phoenix.Plug.shape!(Table, [:visible])

  is equivalent to:

      from(
        t in Table,
        where: t.visible == ^conn.params["visible"]
      )

  If you need to match on something other than `==` then you can pass the operator in the params:

      Electric.Phoenix.Plug.shape!(Table, size: [>=: :size])

  is equivalent to:

      from(
        t in Table,
        where: t.size >= ^conn.params["size"]
      )

  Instead of calling `shape!/2` directly in your route definition, you can just
  pass a list of `[query | params]` to do the same thing:

      forward "/shapes/tasks/:project_id",
        to: Electric.Plug,
        shape: [
          from(t in Task, where: t.active == true),
          project_id: :project_id
        ]

  """
  @spec shape!(Electric.Phoenix.shape_definition(), dynamic_shape_params()) :: term()
  def shape!(query, params) when is_list(params) do
    [query | params]
  end

  defp dynamic_shape(conn, query, params) do
    conn = Plug.Conn.fetch_query_params(conn)

    shape =
      Enum.reduce(params, query, fn
        {column, {op, param}}, query ->
          value = conn.params[to_string(param)]

          add_filter(query, column, op, value)

        {column, param}, query ->
          value = conn.params[to_string(param)]
          add_filter(query, column, :==, value)
      end)
      |> Electric.Client.shape!()

    Plug.Conn.assign(conn, :shape, shape)
  end

  for op <- @valid_ops do
    where =
      {op, [],
       [
         {:field, [], [Macro.var(:q, nil), {:^, [], [Macro.var(:column, nil)]}]},
         {:^, [], [Macro.var(:value, nil)]}
       ]}

    defp add_filter(query, var!(column), unquote(op), var!(value)) do
      Ecto.Query.where(query, [q], unquote(where))
    end
  end

  @doc ~S"""
  Send the client configuration for a given shape to the browser.

  ## Example

      get "/my-shapes/messages" do
        user_id = get_session(conn, :user_id)
        shape = from(m in Message, where: m.user_id == ^user_id)
        Electric.Phoenix.Plug.send_configuration(conn, shape)
      end

      get "/my-shapes/tasks/:project_id" do
        project_id = conn.params["project_id"]

        if user_has_access_to_project?(project_id) do
          shape = where(Task, project_id: ^project_id)
          Electric.Phoenix.Plug.send_configuration(conn, shape)
        else
          send_resp(conn, :forbidden, "You do not have permission to view project #{project_id}")
        end
      end

  """
  @spec send_configuration(Plug.Conn.t(), Electric.Phoenix.shape_definition(), Client.t()) ::
          Plug.Conn.t()
  def send_configuration(conn, shape_or_queryable, client \\ Electric.Phoenix.client!()) do
    shape = normalise_shape(shape_or_queryable)
    configuration = Gateway.configuration(shape, client)
    additional_headers = authentication_headers(conn, shape)

    configuration =
      Map.update(configuration, "headers", additional_headers, &Map.merge(&1, additional_headers))

    conn
    |> Plug.Conn.put_resp_content_type("application/json")
    |> Plug.Conn.send_resp(200, Jason.encode!(configuration))
  end

  # TODO: remove this once Electric.Client.shape!/1 is idempotent and passes
  #       through ShapeDefinition structs as-is
  defp normalise_shape(%Electric.Client.ShapeDefinition{} = shape) do
    shape
  end

  defp normalise_shape(queryable) do
    Electric.Client.shape!(queryable)
  end

  defp authentication_headers(conn, shape) do
    conn
    |> authenticator_fun()
    |> apply_authenticator_fun(conn, shape)
  end

  defp apply_authenticator_fun({module, function, opts}, conn, shape) do
    apply(module, function, [conn, shape, opts])
  end

  defp apply_authenticator_fun(fun, conn, shape) when is_function(fun, 2) do
    fun.(conn, shape)
  end

  defp authenticator_fun(%{assigns: %{config: %{authenticator: authenticator}}}) do
    authenticator
  end

  defp authenticator_fun(_conn) do
    fn _conn, _shape -> %{} end
  end
end
