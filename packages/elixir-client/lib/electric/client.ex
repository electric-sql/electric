defmodule Electric.Client do
  @moduledoc """
  An Elixir client for the [ElectricSQL synchronisation server](https://electric-sql.com/).

  Subscribing to a particular
  [Shape](https://electric-sql.com/docs/guides/shapes) produce a stream of
  update messages that will allow you to synchronise your local system to the
  state the Postgres database.

  ## Quickstart

  ### Start and connect the Electric Sync Service

  Follow the [quickstart guide](https://electric-sql.com/docs/quickstart) to
  get Electric running and connected to a Postgres database.

  ### Install the Electric Client and Receive sync events

  Create a simple script that will subscribe to events from the `foo` table you created as part of the [Quickstart](#quickstart).

  ``` elixir
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
  ```

  Then run it:

  ```sh
  elixir electric.ex
  ```

  In a separate terminal window, connect to the Postgres database:

  ```sh
  psql "postgresql://postgres:password@localhost:54321/electric"
  ```

  Now any modifications you make to the data in the `foo` table will appear
  as messages in the elixir process.

  ```sql
  INSERT INTO foo (name, value) VALUES
      ('josevalim', 4545),
      ('eksperimental', 966),
      ('lexmag', 677),
      ('whatyouhide', 598),
      ('ericmj', 583),
      ('alco', 377);

  UPDATE foo SET value = value + 1;
  ```

  ### Filtering Using WHERE clauses

  You can subscribe to subsets of the data in your table using [`where` clauses](https://electric-sql.com/docs/guides/shapes#where-clause).


  ``` elixir
  {:ok, client} = Electric.Client.new(base_url: "http://localhost:3000")

  shape = Electric.Client.ShapeDefinition.new("foo", where: "name ILIKE 'a%'")

  stream = Electric.Client.stream(client, shape)

  for msg <- stream do
    # you will now only receive events for database rows matching the `where` clause
  end
  ```

  ## Configuration

  See `new/1` for configuration options of the client itself,
  and `stream/3` for details on configuring the stream itself.

  ## Ecto Integration

  If you have [Ecto](https://hexdocs.pm/ecto) installed then you can define you Shapes using Ecto queries:

  ``` elixir
  # ecto.ex
  Mix.install([
    :ecto,
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
  # `update_mode` to `:full` to receive full rows for update messages.
  #
  # The normal `update_mode: :modified` setting will only send the changed
  # columns, so we'd end up with partial `%Foo{}` instances.
  stream =
    Electric.Client.stream(
      client,
      from(f in Foo, where: ilike(f.name, "a%")),
      update_mode: :full
    )

  for %{headers: %{operation: operation}, value: value} <- stream do
    # The message `value` will now be a `%Foo{}` struct 
    IO.inspect([{operation, value}], pretty: true, syntax_colors: IO.ANSI.syntax_colors())
  end
  ```

  ## Custom Values

  Electric sends all column values as binaries. The `Ecto` integration uses
  `Ecto`'s schema information to turn those into the relevant Elixir terms but
  we can provide our own `binary() => term()` mapping by implementing the
  [`Electric.Client.ValueMapper` behaviour](`Electric.Client.ValueMapper`).

  """

  alias Electric.Client.Fetch
  alias Electric.Client.Offset
  alias Electric.Client.ShapeDefinition
  alias Electric.Client.Util

  alias __MODULE__

  defmodule Error do
    defexception [:message, :resp]
  end

  defstruct [
    :base_url,
    :fetch
  ]

  @client_schema NimbleOptions.new!(
                   base_url: [
                     type: :string,
                     required: true,
                     doc:
                       "The URL of the electric server, e.g. for local development this would be `http://localhost:3000`."
                   ],
                   fetch: [type: :mod_arg, default: {Client.Fetch.HTTP, []}, doc: false]
                 )

  @type shape_id :: String.t()
  @type update_mode :: :modified | :full
  @type column :: %{
          required(:type) => String.t(),
          optional(:pk_index) => non_neg_integer(),
          optional(:not_null) => boolean(),
          optional(:max_length) => non_neg_integer(),
          optional(:length) => non_neg_integer()
        }
  @type schema :: %{String.t() => column()}
  @type message :: ControlMessage.t() | ChangeMessage.t()
  @type param :: :offset | :update_mode | :shape_id | :live | :where
  @type params :: %{param() => String.t()}
  @type table_name :: String.t()
  @type client_option :: unquote(NimbleOptions.option_typespec(@client_schema))
  @type client_options :: [client_option()]
  @type shape :: table_name() | ShapeDefinition.t() | Ecto.Queryable.t()
  @type shape_option :: unquote(NimbleOptions.option_typespec(Client.Stream.options_schema()))
  @type shape_options :: [shape_option()]

  @type t :: %__MODULE__{
          base_url: String.t(),
          fetch: {module(), term()}
        }

  @doc """
  Create a new client.

  ## Options

  #{NimbleOptions.docs(@client_schema)}
  """
  @spec new(client_options()) :: {:ok, t()}
  def new(opts) do
    with {:ok, attrs} <- NimbleOptions.validate(opts, @client_schema) do
      {:ok, struct(__MODULE__, attrs)}
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
  A shortcut to `ShapeDefinition.new/2`.
  """
  @spec shape(String.t(), ShapeDefinition.options()) :: ShapeDefinition.t()
  def shape(table_name, opts \\ [])

  def shape(table_name, opts) do
    ShapeDefinition.new(table_name, opts)
  end

  @doc """
  Use the `client` to return a stream of update messages for the given `shape`.

  `shape` can be a table name, e.g. `"my_table"`, a full `ShapeDefinition`
  including a table name and `where` clause, or (if `Ecto` is installed) an
  `Ecto.Queryable` instance, such as an `Ecto.Query` or a `Ecto.Schema` struct.

  ## Options

  #{NimbleOptions.docs(Client.Stream.options_schema())}
  """
  @spec stream(t(), shape(), shape_options()) :: Enumerable.t(message())
  def stream(client, shape_or_query, opts \\ [])

  if Code.ensure_loaded?(Ecto) do
    def stream(%Client{} = client, queryable, opts) when is_atom(queryable) do
      if function_exported?(queryable, :__schema__, 1) do
        {shape_definition, parser} = Electric.Client.EctoAdapter.shape_from_query!(queryable)
        stream(client, shape_definition, Keyword.put(opts, :parser, parser))
      else
        raise ArgumentError, message: "Expected Ecto struct or query, got #{inspect(queryable)}"
      end
    end

    def stream(%Client{} = client, %Ecto.Query{} = query, opts) do
      {shape_definition, parser} = Electric.Client.EctoAdapter.shape_from_query!(query)
      stream(client, shape_definition, Keyword.put(opts, :parser, parser))
    end
  end

  def stream(%Client{} = client, table_name, opts) when is_binary(table_name) do
    stream(client, ShapeDefinition.new(table_name), opts)
  end

  def stream(%Client{} = client, %ShapeDefinition{} = shape, opts) do
    Client.Stream.new(client, shape, opts)
  end

  @doc false
  @spec request(t(), Keyword.t()) :: Fetch.Request.t()
  def request(%Client{} = client, opts) do
    struct(%Fetch.Request{base_url: client.base_url}, opts)
  end

  @doc false
  @spec params(Fetch.Request.t()) :: params()
  def params(%Fetch.Request{} = request) do
    %{
      shape: %ShapeDefinition{where: where},
      update_mode: update_mode,
      live: live?,
      shape_id: shape_id,
      offset: %Offset{} = offset
    } = request

    %{offset: Offset.to_string(offset)}
    |> Util.map_put_if(:update_mode, to_string(update_mode), update_mode != :modified)
    |> Util.map_put_if(:shape_id, shape_id, is_binary(shape_id))
    |> Util.map_put_if(:live, "true", live?)
    |> Util.map_put_if(:where, where, is_binary(where))
  end

  @doc """
  Use the given `client` to delete the `shape` instance from the server.

  Delete shape only works if Electric is configured to `allow_shape_deletion`.
  """
  def delete_shape(%Client{} = client, %ShapeDefinition{} = shape) do
    request = request(client, method: :delete, shape: shape)
    Electric.Client.Fetch.Request.request(request, client.fetch)
  end
end
