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
  alias Electric.Client.ShapeDefinition
  alias Electric.Client.Message

  alias __MODULE__

  defmodule Error do
    defexception [:message, :resp]
  end

  defstruct [
    :base_url,
    :database_id,
    :fetch,
    :authenticator
  ]

  @client_schema NimbleOptions.new!(
                   base_url: [
                     type: :string,
                     required: true,
                     doc:
                       "The URL of the electric server, e.g. for local development this would be `http://localhost:3000`."
                   ],
                   database_id: [
                     type: {:or, [nil, :string]},
                     doc:
                       "Which database to use, optional unless Electric is used with multiple databases."
                   ],
                   fetch: [type: :mod_arg, default: {Client.Fetch.HTTP, []}, doc: false],
                   authenticator: [
                     type: :mod_arg,
                     default: {Client.Authenticator.Unauthenticated, []},
                     doc: false
                   ]
                 )

  @type shape_handle :: String.t()
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
          base_url: URI.t(),
          fetch: {module(), term()}
        }

  @doc """
  Create a new client.

  ## Options

  #{NimbleOptions.docs(@client_schema)}
  """
  @spec new(client_options()) :: {:ok, t()} | {:error, term()}
  def new(opts) do
    with {:ok, attrs} <- NimbleOptions.validate(Map.new(opts), @client_schema),
         {:ok, uri} <- URI.new(attrs[:base_url]) do
      {:ok, struct(__MODULE__, Map.put(attrs, :base_url, uri))}
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
    @doc """
    Create a [`ShapeDefinition`](`Electric.Client.ShapeDefinition`) from an `Ecto` query.

    Accepts any implementation of `Ecto.Queryable` (e.g. an [`%Ecto.Query{}`](`Ecto.Query`) struct or
    `Ecto.Schema` module) to generate a [`ShapeDefinition`](`Electric.Client.ShapeDefinition`).

        iex> query = from(t in MyApp.Todo, where: t.completed == false)
        iex> Elixir.Client.shape!(query)
        %Electric.Client.ShapeDefinition{table: "todos" where: "(\\"completed\\" = FALSE)"}

    Values from the Electric change stream will be mapped to instances of the
    passed `Ecto.Schema` module.
    """
    @spec shape!(Ecto.Queryable.t()) :: ShapeDefinition.t() | no_return()
    def shape!(queryable) when is_atom(queryable) do
      queryable
      |> validate_queryable!()
      |> Electric.Client.EctoAdapter.shape_from_query!()
    end

    def shape!(%Ecto.Query{} = query) do
      Electric.Client.EctoAdapter.shape_from_query!(query)
    end
  end

  @doc """
  A shortcut to [`ShapeDefinition.new!/2`](`Electric.Client.ShapeDefinition.new!/2`).
  """
  def shape!(table_or_query, opts \\ [])

  @spec shape!(String.t(), ShapeDefinition.options()) :: ShapeDefinition.t() | no_return()
  def shape!(table_name, opts) when is_binary(table_name) do
    ShapeDefinition.new!(table_name, opts)
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
  def stream(client, shape_or_query, opts \\ [])

  if Code.ensure_loaded?(Ecto) do
    def stream(%Client{} = client, queryable, opts) when is_atom(queryable) do
      shape_definition = shape!(queryable)

      stream(client, shape_definition, opts)
    end

    def stream(%Client{} = client, %Ecto.Query{} = query, opts) do
      shape_definition = shape!(query)
      stream(client, shape_definition, opts)
    end
  end

  def stream(%Client{} = client, table_name, opts) when is_binary(table_name) do
    stream(client, ShapeDefinition.new!(table_name), opts)
  end

  def stream(%Client{} = client, %ShapeDefinition{} = shape, opts) do
    Client.Stream.new(client, shape, opts)
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
    struct(%Fetch.Request{base_url: client.base_url, database_id: client.database_id}, opts)
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
    Electric.Client.Fetch.Request.request(client, request)
  end

  defp validate_queryable!(queryable) when is_atom(queryable) do
    Code.ensure_loaded!(queryable)

    if function_exported?(queryable, :__schema__, 1) do
      queryable
    else
      raise ArgumentError, message: "Expected Ecto struct or query, got #{inspect(queryable)}"
    end
  end
end
