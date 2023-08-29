defmodule Electric.Postgres.Proxy.TestScenario do
  alias PgProtocol.Message, as: M
  alias Electric.Postgres.Proxy.Injector

  import ExUnit.Assertions

  defmodule MockInjector do
    @behaviour Electric.Postgres.Proxy.Injector

    def capture_ddl_query(query) do
      ~s|SELECT electric.capture_ddl('#{query}')|
    end

    def capture_version_query(version \\ migration_version()) do
      ~s|SELECT electric.migration_version('#{version}')|
    end

    def migration_version do
      "20230801111111_11"
    end
  end

  defmodule MockLoader do
    @behaviour Electric.Postgres.SchemaLoader

    defstruct parent: nil, electrified_tables: nil, electrified_indexes: nil

    def connect(_config, opts) do
      {:ok, parent} = Keyword.fetch(opts, :parent)
      tables = Keyword.get(opts, :electrified_tables, []) |> MapSet.new()
      indexes = Keyword.get(opts, :electrified_indexes, []) |> MapSet.new()
      {:ok, %{parent: parent, electrified_tables: tables, electrified_indexes: indexes}}
    end

    def table_electrified?(%{electrified_tables: electrified}, table_name) do
      MapSet.member?(electrified, table_name)
    end

    def index_electrified?(%{electrified_indexes: electrified}, index_name) do
      MapSet.member?(electrified, index_name)
    end
  end

  defmacro __using__(_opts) do
    m = __MODULE__

    message_aliases =
      for t <- M.types() do
        quote do
          alias unquote(t)
        end
      end

    quote do
      alias Electric.DDLX
      alias unquote(m).{MockInjector, MockLoader}

      unquote(message_aliases)

      import unquote(m)
    end
  end

  def query(sql) do
    %M.Query{query: sql}
  end

  def begin() do
    query("BEGIN")
  end

  def commit() do
    query("COMMIT")
  end

  def rollback() do
    query("ROLLBACK")
  end

  def complete(tag) do
    %M.CommandComplete{tag: tag}
  end

  def ready(status) do
    %M.ReadyForQuery{status: status}
  end

  def complete_ready() do
    complete_ready(random_tag())
  end

  def complete_ready(tag, status \\ :tx) do
    [complete(tag), ready(status)]
  end

  def parse_describe(sql, name \\ "") do
    [
      %M.Parse{query: sql, name: name},
      %M.Describe{name: name},
      %M.Flush{}
    ]
  end

  def parse_describe_complete(params \\ []) do
    [
      %M.ParseComplete{},
      struct(%M.ParameterDescription{}, params),
      %M.NoData{}
    ]
  end

  def bind_execute() do
    bind_execute("", [])
  end

  def bind_execute(name, params \\ []) do
    bind_params = Keyword.get(params, :bind, [])

    [
      struct(
        %M.Bind{
          portal: name,
          source: "",
          parameter_format_codes: [],
          parameters: [],
          result_format_codes: []
        },
        bind_params
      ),
      %M.Execute{portal: "", max_rows: 0},
      %M.Close{type: "S", name: name},
      %M.Sync{}
    ]
  end

  def bind_execute_complete() do
    bind_execute_complete(random_tag())
  end

  @spec bind_execute_complete(String.t(), :tx | :idle | :failed | false) :: [M.t()]
  def bind_execute_complete(tag, status \\ :tx)

  def bind_execute_complete(tag, false) do
    [
      %M.BindComplete{},
      %M.CommandComplete{tag: tag},
      %M.CloseComplete{}
    ]
  end

  def bind_execute_complete(tag, status) do
    [
      %M.BindComplete{},
      %M.CommandComplete{tag: tag},
      %M.CloseComplete{},
      %M.ReadyForQuery{status: status}
    ]
  end

  def error(args \\ []) do
    struct(M.ErrorResponse, Keyword.put_new(args, :severity, "ERROR"))
  end

  def capture_version_query() do
    query(MockInjector.capture_version_query())
  end

  def capture_version_query(version) do
    query(MockInjector.capture_version_query(version))
  end

  def capture_ddl_query(sql) do
    query(MockInjector.capture_ddl_query(sql))
  end

  def capture_version_complete(status \\ :tx) do
    electric_call_complete(status)
  end

  def capture_ddl_complete(status \\ :tx) do
    electric_call_complete(status)
  end

  # splitting this out as a function in order to simplify the process of
  # updating the expected messages when calling an electric procedure
  def electric_call_complete(status \\ :tx) do
    [
      %M.RowDescription{},
      %M.DataRow{},
      %M.CommandComplete{tag: "SELECT 1"},
      %M.ReadyForQuery{status: status}
    ]
  end

  @doc """
  Asserts that the injector is in the idle state, so outside a transaction
  with no active capture mode.
  """
  def idle!({nil, state} = injector) do
    refute Injector.State.tx?(state)
    injector
  end

  def idle!({capture, state}) do
    flunk(
      "Message sequence ended with pending capture state:\ncapture: #{inspect(capture)}\ntx: #{inspect(state.tx)}"
    )
  end

  def frameworks() do
    [Electric.Proxy.InjectorTest.EctoFramework]
  end

  @doc """
  Given an injector mid-tx generates migration version query flows for the
  given framework modules and asserts that the version is captured correctly

  This ignores the specifics of the scenario file because a framework
  always does the same thing.
  """
  def assert_capture_migration_version(injector, version) do
    # we use the stame injector state for all frameworks then (arbitrarily)
    # return the last one back to the test on the assumption that all versions
    # of the process return an injector in the same state
    frameworks()
    |> Enum.map(& &1.capture_migration_version(injector, version))
    |> List.last()
  end

  def assign_migration_version(injector, version) do
    frameworks()
    |> Enum.map(& &1.assign_migration_version(injector, version))
    |> List.last()
  end

  def version_pg(version) when is_integer(version) do
    <<version::integer-signed-big-64>>
  end

  def version_pg(%DateTime{} = datetime) do
    datetime
    |> DateTime.to_unix(:microsecond)
    |> version_pg()
  end

  @doc """
  Ensure that electric commands are correctly re-written into valid sequence
  of queries and that expected final response to client is valid.

  Can't be done declaratively because a command can return a variable number of
  sql statements that must be executed sequentially.
  """
  def electric(injector, initial_messages, command, final_messages, opts \\ []) do
    initial_origin = Keyword.get(opts, :origin, :client)

    case Electric.DDLX.Command.pg_sql(command) |> Enum.map(&query/1) do
      # TODO: what do we do here?
      # [] ->
      #   client(injector, initial_messages, )

      [query | queries] ->
        # the initial client message which is a [bind, execute] or [query] message
        # triggers a re-write to the real procedure call
        injector =
          case initial_origin do
            :client ->
              client(injector, initial_messages, server: query)

            :server ->
              server(injector, initial_messages, server: query)
          end

        # this real proc call returns a readyforquery etc response which triggers
        # the next procedure call required for the electric command
        Enum.reduce(queries, injector, fn query, injector ->
          injector
          |> server(electric_call_complete(), server: query)
        end)
        # on receipt of the last readyforquery, the injector returns
        # the required message sequence that the client is expecting for
        # it's initial `ELECTRIC ...` query
        |> server(electric_call_complete(), [{initial_origin, final_messages}])
    end
  end

  @doc """
  Validate messages from the server are proxied to the client as-is
  """
  def server(injector, server_messages) do
    server(injector, server_messages, client: server_messages)
  end

  @doc """
  Validate messages from the server trigger messages to the given recipients,

  `receipients` is a Keyword list with expected message lists for the
  `:client` or the `:server`.

  e.g.

      # test that a ReadyForQuery message from the server results in a
      # commit from the proxy to the server
      server([%M.ReadyForQuery{status: :tx}], server: [%M.Query{query: "COMMIT"}])

  """
  def server(injector, server_messages, receipients) do
    expected_server_server =
      Keyword.get(receipients, :server, []) |> to_struct()

    expected_server_client =
      Keyword.get(receipients, :client, []) |> to_struct()

    {:ok, injector, server_server, server_client} =
      Injector.recv_backend(injector, to_struct(server_messages))

    # validate both sets of messages in a single assertion so that
    # a failure shows the full state
    assert [
             server_server: server_server,
             server_client: server_client
           ] == [
             server_server: expected_server_server,
             server_client: expected_server_client
           ]

    injector
  end

  @doc """
  Validate that messages from the client are forwarded as-is to the server.
  """
  def client(injector, client_messages) do
    client(injector, client_messages, server: client_messages)
  end

  @doc """
  Validate messages from the server trigger messages to the given recipients,

  `receipients` is a Keyword list with expected message lists for the
  `:client` or the `:server`.

  """
  def client(injector, client_messages, receipients) do
    expected_client_server = Keyword.get(receipients, :server, []) |> to_struct()
    expected_client_client = Keyword.get(receipients, :client, []) |> to_struct()

    {:ok, injector, client_server, client_client} =
      Injector.recv_frontend(injector, to_struct(client_messages))

    # validate both sets of messages in a single assertion so that
    # a failure shows the full state
    assert [
             client_server: client_server,
             client_client: client_client
           ] == [
             client_server: expected_client_server,
             client_client: expected_client_client
           ]

    injector
  end

  @doc """
  Transform a single message module or list of modules into a list of message
  structs.
  """
  def to_struct(m) do
    m
    |> List.wrap()
    |> List.flatten()
    |> Enum.map(&to_struct_internal/1)
  end

  defp to_struct_internal(m) when is_atom(m) do
    struct(m)
  end

  defp to_struct_internal(s) when is_struct(s) do
    s
  end

  # ensure that original response is returned using a random tag
  def random_tag do
    "TAG #{:crypto.strong_rand_bytes(8) |> Base.encode16()}"
  end
end

defmodule MockLoader do
  @behaviour Electric.Postgres.SchemaLoader

  defstruct parent: nil, electrified_tables: nil, electrified_indexes: nil

  def connect(_config, opts) do
    {:ok, parent} = Keyword.fetch(opts, :parent)
    tables = Keyword.get(opts, :electrified_tables, []) |> MapSet.new()
    indexes = Keyword.get(opts, :electrified_indexes, []) |> MapSet.new()
    {:ok, %{parent: parent, electrified_tables: tables, electrified_indexes: indexes}}
  end

  def table_electrified?(%{electrified_tables: electrified}, table_name) do
    MapSet.member?(electrified, table_name)
  end

  def index_electrified?(%{electrified_indexes: electrified}, index_name) do
    MapSet.member?(electrified, index_name)
  end
end
