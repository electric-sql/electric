defmodule Electric.Client do
  @moduledoc """
  An Elixir client for [ElectricSQL](https://electric-sql.com).

  Electric is a sync engine that allows you to sync
  [little subsets](https://electric-sql.com/docs/guides/shapes)
  of data from Postgres into local apps and services. This client
  allows you to sync data from Electric into Elixir applications.

  ## Quickstart

  ### Start and connect the Electric sync service

  Follow the
  [Installation guide](https://electric-sql.com/docs/guides/installation)
  to get Electric up-and-running and connected to a Postgres database.

  ### Create a table

  Create a `foo` table in your Postgres schema, as per the Electric
  [Quickstart guide](https://electric-sql.com/docs/guides/installation),
  so that we have a table to sync.

      CREATE TABLE foo (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255),
          value FLOAT
      );

  ### Install the Electric Client and receive sync events

  Create a simple script that will subscribe to events from a `foo` table
  in your Postgres database,

      # electric.ex
      Mix.install([
        :electric_client
      ])

      {:ok, client} = Electric.Client.new(base_url: "http://localhost:3000")

      # You can create a stream from a table name or a Shape defined using
      # `ShapeDefinition.new/2`
      stream = Electric.Client.stream(client, "foo")

      for msg <- stream do
        IO.inspect(msg, pretty: true, syntax_colors: IO.ANSI.syntax_colors())
      end

  Then run it:

      elixir electric.ex

  In a separate terminal window, connect to the Postgres database:

      psql "postgresql://postgres:password@localhost:54321/electric"

  Now any modifications you make to the data in the `foo` table will appear
  as messages in the elixir process.

      INSERT INTO foo (name, value) VALUES
          ('josevalim', 4545),
          ('eksperimental', 966),
          ('lexmag', 677),
          ('whatyouhide', 598),
          ('ericmj', 583),
          ('alco', 377);

      UPDATE foo SET value = value + 1;

  ### Filtering Using WHERE clauses

  You can subscribe to subsets of the data in your table using
  [`where` clauses](https://electric-sql.com/docs/guides/shapes#where-clause).

      {:ok, client} = Electric.Client.new(base_url: "http://localhost:3000")

      {:ok, shape} = Electric.Client.ShapeDefinition.new("foo", where: "name ILIKE 'a%'")

      stream = Electric.Client.stream(client, shape)

      for msg <- stream do
        # you will now only receive events for database rows matching the `where` clause
      end

  ## Configuration

  See `new/1` for configuration options of the client itself,
  and `stream/3` for details on configuring the stream itself.

  ## Ecto Integration

  If you have [Ecto](https://hexdocs.pm/ecto) installed then you can define your Shapes
  using Ecto queries:

      # ecto.ex
      Mix.install([
        :ecto_sql,
        :electric_client
      ])

      import Ecto.Query, only: [from: 2]
      import Ecto.Query.API, only: [ilike: 2]

      defmodule Foo do
        use Ecto.Schema

        schema "foo" do
          field :name, :string
          field :value, :float
        end
      end

      {:ok, client} = Electric.Client.new(base_url: "http://localhost:3000")

      # Replace the table or `ShapeDefinition` with an `Ecto` query and set
      # `replica` to `:full` to receive full rows for update messages.
      #
      # The normal `replica: :default` setting will only send the changed
      # columns, so we'd end up with partial `%Foo{}` instances.
      stream =
        Electric.Client.stream(
          client,
          from(f in Foo, where: ilike(f.name, "a%")),
          replica: :full
        )

      for %{headers: %{operation: operation}, value: value} <- stream do
        # The message `value` will now be a `%Foo{}` struct
        IO.inspect([{operation, value}], pretty: true, syntax_colors: IO.ANSI.syntax_colors())
      end

  ## Custom Values

  Electric sends all column values as binaries. The `Ecto` integration uses
  `Ecto`'s schema information to turn those into the relevant Elixir terms but
  we can provide our own `binary() => term()` mapping by implementing the
  [`Electric.Client.ValueMapper` behaviour](`Electric.Client.ValueMapper`).

  """

  alias Electric.Client.Fetch
  alias Electric.Client.Poll
  alias Electric.Client.ShapeDefinition
  alias Electric.Client.ShapeState
  alias Electric.Client.Message

  alias __MODULE__

  defmodule Error do
    defexception [:message, :resp]
  end

  defstruct [
    :endpoint,
    :fetch,
    :authenticator,
    :pool,
    :params,
    :parser
  ]

  @api_endpoint_path "/v1/shape"
  @client_schema NimbleOptions.new!(
                   base_url: [
                     type: {:or, [:string, {:struct, URI}]},
                     doc:
                       "The URL of the electric server, not including the path. E.g. for local development this would be `http://localhost:3000`."
                   ],
                   endpoint: [
                     type: {:or, [:string, {:struct, URI}]},
                     doc:
                       "The full URL of the shape API endpoint. E.g. for local development this would be `http://localhost:3000/v1/shape`. Use this if you need a non-standard API path."
                   ],
                   params: [
                     type: {:map, :atom, :any},
                     default: %{},
                     doc:
                       "Additional query parameters to include in every request to the Electric backend."
                   ],
                   parser: [
                     type: :mod_arg,
                     default: {Electric.Client.ValueMapper, []},
                     doc: """
                     A `{module, args}` tuple specifying the `Electric.Client.ValueMapper`
                     implementation to use for mapping values from the sync stream into Elixir
                     terms.
                     """
                   ],
                   authenticator: [
                     type: :mod_arg,
                     default: {Client.Authenticator.Unauthenticated, []},
                     doc: false
                   ],
                   fetch: [
                     type: :mod_arg,
                     default: {Client.Fetch.HTTP, []},
                     doc: """
                     A `{module, opts}` tuple specifying the `Electric.Client.Fetch`
                     implementation to use for calling the Electric API.

                     See `Electric.Client.Fetch.HTTP` for the options available
                     when using the default `HTTP` fetcher.

                          Client.new(
                            base_url: "http://localhost:3000",
                            fetch: {Electric.Client.Fetch.HTTP,
                              # never error, just keep retrying if the Electric server is down
                              timeout: :infinity,
                              # add a bearer token to every request (see `authenticator` if you need more
                              # control over authenticating your requests
                              headers: [{"authorize", "Bearer some-token-here"}]}
                          )
                     """
                   ],
                   pool: [type: :mod_arg, default: {Electric.Client.Fetch.Pool, []}, doc: false]
                 )

  @type shape_handle :: String.t()
  @type offset :: Electric.Client.Offset.t()
  @type cursor :: integer()
  @type replica :: :default | :full
  @type column :: %{
          required(:type) => String.t(),
          optional(:pk_index) => non_neg_integer(),
          optional(:not_null) => boolean(),
          optional(:max_length) => non_neg_integer(),
          optional(:length) => non_neg_integer()
        }
  @type schema :: %{String.t() => column()}
  @type message ::
          Message.ControlMessage.t() | Message.ChangeMessage.t() | Message.ResumeMessage.t()
  @type table_name :: String.t()
  @type client_option :: unquote(NimbleOptions.option_typespec(@client_schema))
  @type client_options :: [client_option()]
  @type shape :: table_name() | ShapeDefinition.t() | Ecto.Queryable.t()
  @type stream_option :: unquote(NimbleOptions.option_typespec(Client.Stream.options_schema()))
  @type stream_options :: [stream_option()]

  @type t :: %__MODULE__{
          endpoint: URI.t(),
          fetch: {module(), term()}
        }
  if Code.ensure_loaded?(Ecto) do
    @type ecto_shape() :: Ecto.Queryable.t() | Ecto.Changeset.t() | (map() -> Ecto.Changeset.t())

    # queryable is a schema module, an ecto query, a function that returns a changeset
    # or a changeset
    defguardp is_ecto_shape(ecto_queryable)
              when is_atom(ecto_queryable) or is_struct(ecto_queryable, Ecto.Query) or
                     is_function(ecto_queryable, 1) or is_struct(ecto_queryable, Ecto.Changeset)
  end

  @doc """
  Create a new client.

  ## Options

  #{NimbleOptions.docs(@client_schema)}

  ### `:base_url` vs. `:endpoint`

  If you configure your client using e.g. `base_url: "http://localhost:3000"`
  Electric will append the default shape API path
  `#{inspect(@api_endpoint_path)}` to create the final endpoint configuration,
  in this case `"http://localhost:3000#{@api_endpoint_path}"`.

  If you wish to use a non-standard endpoint path because, for example, you wrap your Shape
  API calls in an [authentication
  proxy](https://electric-sql.com/docs/guides/auth), then configure
  the endpoint directly:

      Client.new(endpoint: "https://my-server.my-domain.com/electric/shape/proxy")

  """
  @spec new(client_options()) :: {:ok, t()} | {:error, term()}
  def new(opts) do
    with {:ok, attrs} <- NimbleOptions.validate(Map.new(opts), @client_schema),
         %{fetch: {fetch_module, fetch_opts}} = attrs,
         {:ok, fetch_opts} <- fetch_module.validate_opts(fetch_opts),
         {:ok, endpoint} <- client_endpoint(attrs) do
      {:ok,
       struct(
         __MODULE__,
         Map.merge(attrs, %{endpoint: endpoint, fetch: {fetch_module, fetch_opts}})
       )}
    end
  end

  defp client_endpoint(attrs) when is_map(attrs) do
    case Map.fetch(attrs, :endpoint) do
      {:ok, endpoint} ->
        URI.new(endpoint)

      :error ->
        case Map.fetch(attrs, :base_url) do
          {:ok, url} ->
            with {:ok, uri} <- URI.new(url) do
              {:ok, URI.append_path(uri, @api_endpoint_path)}
            end

          :error ->
            {:error, "Client requires either a :base_url or :endpoint configuration"}
        end
    end
  end

  @doc """
  Create a new client with the given options or raise if the configuration is
  invalid.
  """
  @spec new!(client_options()) :: t() | no_return()
  def new!(opts) do
    case new(opts) do
      {:ok, client} -> client
      {:error, reason} -> raise ArgumentError, message: reason
    end
  end

  if Code.ensure_loaded?(Electric.Application) do
    @doc """
    Get a client instance that runs against an embedded instance of electric,
    that is an electric app running as a dependency of the current application.
    """
    @spec embedded(Electric.Shapes.Api.options()) :: {:ok, t()} | {:error, term()}
    def embedded(opts \\ []) do
      api =
        Electric.Application.api(Keyword.merge(opts, encoder: Electric.Shapes.Api.Encoder.Term))

      Client.new(
        base_url: "elixir://Electric.Client.Embedded",
        fetch: {Electric.Client.Embedded, api: api}
      )
    end

    @spec embedded!(Electric.Shapes.Api.options()) :: t() | no_return()
    def embedded!(opts \\ []) do
      case embedded(opts) do
        {:ok, client} -> client
        {:error, reason} -> raise ArgumentError, message: reason
      end
    end
  end

  @doc """
  A shortcut to [`ShapeDefinition.new/2`](`Electric.Client.ShapeDefinition.new/2`).

      iex> Elixir.Client.shape("my_table")
      {:ok, %Electric.Client.ShapeDefinition{table: "my_table"}}
  """
  @spec shape(String.t(), ShapeDefinition.options()) ::
          {:ok, ShapeDefinition.t()} | {:error, term()}
  def shape(table_name, opts \\ [])

  def shape(table_name, opts) when is_binary(table_name) do
    ShapeDefinition.new(table_name, opts)
  end

  if Code.ensure_loaded?(Ecto) do
    defp validate_queryable!(queryable) when is_atom(queryable) do
      Code.ensure_loaded!(queryable)

      if function_exported?(queryable, :__schema__, 1) do
        queryable
      else
        raise ArgumentError, message: "Expected Ecto struct or query, got #{inspect(queryable)}"
      end
    end

    defp validate_queryable!(%Ecto.Query{} = query), do: query
    defp validate_queryable!(%Ecto.Changeset{} = changeset), do: changeset

    defp validate_queryable!(changeset_fun) when is_function(changeset_fun, 1) do
      changeset_fun
    end

    @doc """
    Create a [`ShapeDefinition`](`Electric.Client.ShapeDefinition`) from an `Ecto` query.

    Accepts any implementation of `Ecto.Queryable` (e.g. an [`%Ecto.Query{}`](`Ecto.Query`) struct or
    `Ecto.Schema` module) to generate a [`ShapeDefinition`](`Electric.Client.ShapeDefinition`).

        iex> query = from(t in MyApp.Todo, where: t.completed == false)
        iex> Elixir.Client.shape!(query)
        %Electric.Client.ShapeDefinition{table: "todos", where: "(\\"completed\\" = FALSE)"}

    Also takes an `Ecto.Changeset` or 1-arity function returning an `Ecto.Changeset`:

        iex> Elixir.Client.shape!(&MyApp.Todo.changeset/1)
        %Electric.Client.ShapeDefinition{table: "todos", columns: ["title", "completed"]}

    Values from the Electric change stream will be mapped to instances of the
    passed `Ecto.Schema` module.

    ## Column subsets

    Specifying a subset of columns to stream can be done in two ways:

    1. Passing a changeset will filter the table columns according to the applied
    validations so if you want a shape to include a column, you must ensure
    that it has some kind of validation, using e.g.
    `Ecto.Changeset.validate_required/2`

    2. Using `Ecto.Query.select/3` to select a subset of columns within the query:

        Electric.Client.shape!(
          from(t in MyApp.Todo, where: t.completed == false, select: [:id, :title])
        )

    [`select/3`](`Ecto.Query.select/3`) allows for various ways to specify the columns,
    we only support the following forms:

    - `select(Todo, [t], [:id, :name])`
    - `select(Todo, [t], [t.id, t.name])`
    - `select(Todo, [t], {t.id, t.name})`
    - `select(Todo, [t], struct(t, [:id, :name]))`
    - `select(Todo, [t], map(t, [:id, :name]))`

    You definitely **can't** add virtual columns like this:

    - `select(Todo, [t], map(t, %{t | reason: "here"}))`

    We also support `Ecto.Query.select_merge/3` to add additional columns:

    - `select(Todo, [t], map(t, [:id, :name])) |> select_merge([:completed])`
    """
    @spec shape!(ecto_shape()) :: ShapeDefinition.t() | no_return()
    def shape!(queryable) when is_ecto_shape(queryable) do
      queryable
      |> validate_queryable!()
      |> Electric.Client.EctoAdapter.shape!()
    end
  end

  # pass through a pre-configured ShapeDefinition as-is so that this is idempotent
  def shape!(%ShapeDefinition{} = shape) do
    shape
  end

  @doc """
  A shortcut to [`ShapeDefinition.new!/2`](`Electric.Client.ShapeDefinition.new!/2`).
  """
  @spec shape!(String.t(), ShapeDefinition.options()) :: ShapeDefinition.t() | no_return()
  def shape!(table_name, opts \\ []) when is_binary(table_name) do
    ShapeDefinition.new!(table_name, opts)
  end

  @doc """
  Get a stream of update messages.

  This accepts a variety of arguments:

  ### Examples:

  - Using a custom endpoint that returns a pre-defined shape.

    If you have used `Electric.Phoenix` to mount a pre-defined shape into your
    Phoenix application, then by creating a client with the `endpoint` set to the
    URL of this route you can stream data directly from this client:

        {:ok, client} = Electric.Client.new(endpoint: "http://localhost:4000/shapes/todo")
        stream = Electric.Client.stream(client)

    Equivalently you can just pass the URL as the argument to stream:

        stream = Electric.Client.stream("http://localhost:4000/shapes/todo")

  - Using a simple table name to define a shape:

        {:ok, client} = Electric.Client.new(base_url: "http://localhost:3000")
        stream = Electric.Client.stream(client, "todos")

  - Using a full shape definition:

        {:ok, client} = Electric.Client.new(base_url: "http://localhost:3000")
        {:ok, shape} = Electric.Client.shape("todos", where: "completed = false", replica: :full)
        stream = Electric.Client.stream(client, shape)

  - Or with an `Ecto` query or `Ecto.Schema` struct:

        {:ok, client} = Electric.Client.new(base_url: "http://localhost:3000")
        stream = Electric.Client.stream(client, from(t in MyApp.Todos.Todo, where: t.completed == false))

  If you want to pass options to your stream, then pass them as the second
  argument or use `stream/3`.
  """
  def stream(client, opts \\ [])

  @spec stream(t(), stream_options()) :: Enumerable.t(message())
  def stream(%Client{} = client, opts) when is_list(opts) do
    Client.Stream.new(client, opts)
  end

  @spec stream(t(), ShapeDefinition.t()) :: Enumerable.t(message())
  def stream(%Client{} = client, %ShapeDefinition{} = shape) do
    stream(client, shape, [])
  end

  if Code.ensure_loaded?(Ecto) do
    @spec stream(t(), String.t() | ecto_shape()) :: Enumerable.t(message())
  else
    @spec stream(t(), String.t()) :: Enumerable.t(message())
  end

  def stream(%Client{} = client, table_or_queryable) do
    stream(client, table_or_queryable, [])
  end

  @spec stream(String.t(), stream_options()) :: Enumerable.t(message())
  def stream(url, opts) when is_binary(url) do
    case new(endpoint: url) do
      {:ok, client} ->
        stream(client, opts)

      {:error, reason} ->
        raise ArgumentError, message: "Invalid client endpoint #{inspect(url)}: #{reason}"
    end
  end

  @doc """
  Use the `client` to return a stream of update messages for the given `shape`.

  `shape` can be a table name, e.g. `"my_table"`, a full `ShapeDefinition`
  including a table name and `where` clause, or (if `Ecto` is installed) an
  `Ecto.Queryable` instance, such as an `Ecto.Query` or a `Ecto.Schema` struct.

  ## Options

  #{NimbleOptions.docs(Client.Stream.options_schema())}
  """
  @spec stream(t(), shape(), stream_options()) :: Enumerable.t(message())

  if Code.ensure_loaded?(Ecto) do
    def stream(%Client{} = client, queryable, opts) when is_ecto_shape(queryable) do
      shape_definition = shape!(queryable)

      stream(client, shape_definition, opts)
    end
  end

  def stream(%Client{} = client, table_name, opts) when is_binary(table_name) do
    stream(client, ShapeDefinition.new!(table_name), opts)
  end

  def stream(%Client{} = client, %ShapeDefinition{} = shape, opts) do
    client
    |> for_shape(shape)
    |> stream(opts)
  end

  @type poll_option :: {:replica, replica()}
  @type poll_options :: [poll_option()]

  @doc """
  Make a single long-polling request to fetch shape changes.

  Unlike `stream/3` which returns an `Enumerable` that continuously fetches,
  `poll/4` makes a single request and returns explicit results. This is useful
  when you want:

  - Explicit control over request timing (rate limiting, batching)
  - Request-response semantics (not a continuous stream)
  - Integration with existing event loops or supervision trees
  - Simpler error handling without stream complexity

  ## Arguments

    * `client` - The Electric client
    * `shape` - The shape definition (table name, `ShapeDefinition`, or Ecto query)
    * `state` - The current polling state (use `ShapeState.new()` for initial request)
    * `opts` - Options:
      * `:replica` - `:default` or `:full` (default: `:default`)

  ## Returns

    * `{:ok, messages, new_state}` - Success, messages received. Use `new_state` for next poll.
    * `{:must_refetch, messages, new_state}` - Shape was reset (409). Local state should be cleared.
    * `{:error, error}` - Error occurred

  ## Example

      # Create initial state
      state = Electric.Client.ShapeState.new()

      # First poll gets initial snapshot (non-live request)
      {:ok, messages, state} = Electric.Client.poll(client, "items", state, replica: :full)

      # Process messages...
      Enum.each(messages, &process_message/1)

      # Subsequent polls are live (long-poll until changes)
      {:ok, messages, state} = Electric.Client.poll(client, "items", state, replica: :full)

  ## Behavior

  - First request (when `state.up_to_date? == false`): Makes a non-live request to get initial snapshot
  - Subsequent requests (when `state.up_to_date? == true`): Makes a live request that long-polls until changes
  - Handles synthetic deletes from move-out events automatically
  """
  @spec poll(t(), shape(), ShapeState.t(), poll_options()) ::
          {:ok, [message()], ShapeState.t()}
          | {:must_refetch, [message()], ShapeState.t()}
          | {:error, Error.t()}
  def poll(client, shape, state, opts \\ [])

  def poll(%Client{} = client, %ShapeDefinition{} = shape, %ShapeState{} = state, opts) do
    client
    |> for_shape(shape)
    |> do_poll(state, opts)
  end

  def poll(%Client{} = client, table_name, %ShapeState{} = state, opts)
      when is_binary(table_name) do
    poll(client, ShapeDefinition.new!(table_name), state, opts)
  end

  if Code.ensure_loaded?(Ecto) do
    def poll(%Client{} = client, queryable, %ShapeState{} = state, opts)
        when is_ecto_shape(queryable) do
      shape_definition = shape!(queryable)
      poll(client, shape_definition, state, opts)
    end
  end

  defp do_poll(%Client{} = client, %ShapeState{} = state, opts) do
    Poll.request(client, state, opts)
  end

  @doc false
  def for_shape(%Client{} = client, %ShapeDefinition{} = shape) do
    shape_params = ShapeDefinition.params(shape)

    client
    |> merge_params(shape_params)
    |> Map.put(:parser, shape.parser)
  end

  @doc false
  def merge_params(%Client{} = client, params) do
    Map.update!(client, :params, &Map.merge(&1, Map.new(params)))
  end

  @doc """
  Return an authenticated URL for the given request attributes.
  """
  @spec url(t(), Fetch.Request.attrs()) :: binary()
  def url(%Client{} = client, opts) do
    request = request(client, opts)
    authenticated_request = authenticate_request(client, request)

    Fetch.Request.url(authenticated_request)
  end

  @doc false
  @spec request(t(), Fetch.Request.attrs()) :: Fetch.Request.t()
  def request(%Client{} = client, opts) do
    params = Map.merge(client.params, Keyword.get(opts, :params, %{}))

    struct(
      %Fetch.Request{endpoint: client.endpoint},
      Keyword.put(opts, :params, params)
    )
  end

  @doc """
  Authenticate the given request using the `authenticator` configured in the `Client`.
  """
  @spec authenticate_request(t(), Fetch.Request.t()) :: Fetch.Request.authenticated()
  def authenticate_request(%Client{authenticator: {module, config}}, %Fetch.Request{} = request) do
    module.authenticate_request(request, config)
  end

  @doc """
  Get authentication query parameters for the given `#{ShapeDefinition}`.
  """
  @spec authenticate_shape(t(), ShapeDefinition.t()) :: Client.Authenticator.headers()
  def authenticate_shape(%Client{authenticator: {module, config}}, %ShapeDefinition{} = shape) do
    module.authenticate_shape(shape, config)
  end

  @doc """
  Use the given `client` to delete the `shape` instance from the server.

  Delete shape only works if Electric is configured to `allow_shape_deletion`.
  """
  def delete_shape(%Client{} = client, %ShapeDefinition{} = shape) do
    request = request(client, method: :delete, shape: shape)
    Electric.Client.Fetch.request(client, request, [])
  end
end
