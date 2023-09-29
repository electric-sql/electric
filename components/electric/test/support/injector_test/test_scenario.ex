defmodule Electric.Postgres.Proxy.TestScenario do
  alias PgProtocol.Message, as: M
  alias Electric.Postgres.Proxy.Injector
  alias Electric.DDLX

  import ExUnit.Assertions

  defmodule MockInjector do
    alias Electric.Postgres.Proxy.Injector
    @behaviour Electric.Postgres.Proxy.Injector

    def capture_ddl_query(query) do
      Injector.capture_ddl_query(query, "$query$")
    end

    def capture_version_query(version \\ migration_version()) do
      Injector.capture_version_query(version, "$query$")
    end

    def alter_shadow_table_query(alteration) do
      Injector.alter_shadow_table_query(alteration, "$query$")
    end

    def migration_version do
      "20230801111111_11"
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
      alias unquote(m).MockInjector
      alias Electric.Postgres.MockSchemaLoader

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

  def capture_notice(_query) do
    M.NoticeResponse
    # {:ok, {sname, tname}} = Parser.table_name(query)
    #
    # struct(M.NoticeResponse,
    #   severity: "NOTICE",
    #   code: "00000",
    #   message: "Migration affecting electrified table #{inspect(sname)}.#{inspect(tname)}",
    #   detail: "Capturing migration: #{query}",
    #   schema: sname,
    #   table: tname
    # )
  end

  def parse_describe(sql, name \\ nil) do
    name = name || random_name()

    [
      # putting the close here makes the tests difficult -- 
      # because we can only really respond to the parse message
      # any close->closecomplete pair should just come through the system
      # (client->server->client) untouched
      # %M.Close{type: "S", name: name},
      %M.Parse{query: sql, name: name},
      %M.Describe{name: name},
      %M.Flush{}
    ]
  end

  defp random_name() do
    "query_#{:crypto.strong_rand_bytes(4) |> Base.encode16(case: :lower)}"
  end

  def parse_describe_complete(params \\ []) do
    [
      # %M.CloseComplete{},
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
    query(MockInjector.capture_version_query(to_string(version)))
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

  def alter_shadow_table_complete(status \\ :tx) do
    electric_call_complete(status)
  end

  # splitting this out as a function in order to simplify the process of
  # updating the expected messages when calling an electric procedure
  def electric_call_complete(status \\ :tx) do
    [
      %M.CommandComplete{tag: "CALL"},
      %M.ReadyForQuery{status: status}
    ]
  end

  @doc """
  Asserts that the injector is in the idle state, so outside a transaction
  with no active capture mode.
  """
  def idle!({[%Electric.Postgres.Proxy.Injector.Electric{}], state} = injector) do
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
    expected_proxy_server =
      Keyword.get(receipients, :server, []) |> to_struct()

    expected_proxy_client =
      Keyword.get(receipients, :client, []) |> to_struct()

    {:ok, injector, proxy_server, proxy_client} =
      Injector.recv_server(injector, to_struct(server_messages))

    assert_messages_equal(
      proxy_server: {proxy_server, expected_proxy_server},
      proxy_client: {proxy_client, expected_proxy_client}
    )

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
    expected_proxy_server = Keyword.get(receipients, :server, []) |> to_struct()
    expected_proxy_client = Keyword.get(receipients, :client, []) |> to_struct()

    {:ok, injector, proxy_server, proxy_client} =
      Injector.recv_client(injector, to_struct(client_messages))

    assert_messages_equal(
      proxy_server: {proxy_server, expected_proxy_server},
      proxy_client: {proxy_client, expected_proxy_client}
    )

    injector
  end

  defp assert_messages_equal(messages) do
    for {direction, {sent, expected}} <- messages do
      if length(sent) != length(expected) do
        assert_unequal(messages)
      end

      for {s, e} <- Enum.zip(sent, expected) do
        equals? =
          case e do
            # special case error  and notice messages -- I don't want to validate the
            # fields in this case, it's enough to know that the response was of the correct type
            %m{} when m in [M.ErrorResponse, M.NoticeResponse] -> is_struct(s, m)
            m -> m == e
          end

        # I want to compare lists of messages, not individual messages, so if there's
        # message mis-match, just assert a comparison of the entire list
        # if !equals?, do: assert([{direction, sent}] == [{direction, expected}])

        if !equals?, do: assert_unequal(messages)
      end
    end
  end

  defp assert_unequal(messages) do
    {expected, received} =
      Enum.reduce(messages, {[], []}, fn {direction, {sent, expected}}, {e, r} ->
        {Keyword.put(e, direction, expected), Keyword.put(r, direction, sent)}
      end)

    # assert([{direction, sent}] == [{direction, expected}])
    assert received == expected
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

  def random_version do
    :rand.uniform(999_999_999_999)
  end

  def execute_tx_sql(sql, injector, mode) when is_binary(sql) do
    execute_tx_sql({:capture, {sql, []}}, injector, mode)
  end

  def execute_tx_sql({sql, opts}, injector, mode) when is_binary(sql) do
    execute_tx_sql({:capture, {sql, opts}}, injector, mode)
  end

  def execute_tx_sql({action, sql}, injector, mode) when is_binary(sql) and is_atom(action) do
    execute_tx_sql({action, {sql, []}}, injector, mode)
  end

  def execute_tx_sql({:passthrough, {query, _opts}}, injector, :simple) do
    injector
    |> client(query(query))
    |> server(complete_ready())
  end

  def execute_tx_sql({:electric, {query, opts}}, injector, :simple) do
    command =
      case Keyword.fetch(opts, :command) do
        {:ok, command} ->
          command

        :error ->
          {:ok, command} = DDLX.ddlx_to_commands(query)
          command
      end

    injector
    |> electric(query(query), command, complete_ready(DDLX.Command.tag(command)))
  end

  def execute_tx_sql({:capture, {query, opts}}, injector, :simple) do
    tag = random_tag()

    injector
    |> client(query(query),
      server: query(query),
      client: [
        # capture_notice(query)
      ]
    )
    |> server(complete_ready(tag), server: capture_ddl_query(query))
    |> shadow_add_column(capture_ddl_complete(), opts, client: complete_ready(tag))
  end

  def execute_tx_sql({:passthrough, {query, _opts}}, injector, :extended) do
    injector
    |> client(parse_describe(query))
    |> server(parse_describe_complete())
    |> client(bind_execute())
    |> server(bind_execute_complete())
  end

  def execute_tx_sql({:electric, {query, opts}}, injector, :extended) do
    command =
      case Keyword.fetch(opts, :command) do
        {:ok, command} ->
          command

        :error ->
          {:ok, command} = DDLX.ddlx_to_commands(query)
          command
      end

    injector
    |> client(parse_describe(query), client: parse_describe_complete(), server: [])
    |> electric(bind_execute(), command, bind_execute_complete(DDLX.Command.tag(command)))
  end

  def execute_tx_sql({:capture, {query, opts}}, injector, :extended) do
    tag = random_tag()

    injector
    |> client(parse_describe(query),
      server: parse_describe(query),
      client: [
        # capture_notice(query)
      ]
    )
    |> server(parse_describe_complete())
    |> client(bind_execute())
    |> server(bind_execute_complete(tag), server: capture_ddl_query(query))
    |> shadow_add_column(capture_ddl_complete(), opts, client: bind_execute_complete(tag))
  end

  def shadow_add_column(injector, initial_msg, opts, final_msgs) when is_list(final_msgs) do
    columns = Keyword.get(opts, :shadow_add_column, [])

    Enum.zip(
      [initial_msg | Enum.map(columns, fn _ -> alter_shadow_table_complete() end)],
      Enum.map(columns, fn c -> [server: alter_shadow_table_query(c)] end) ++ [final_msgs]
    )
    |> Enum.reduce(injector, fn {recv, resp}, injector ->
      server(injector, recv, resp)
    end)
  end

  def alter_shadow_table_query(
        %{
          table: {_schema, _table},
          action: _action,
          column: _column,
          type: _type
        } = alteration
      ) do
    # TODO: support 
    query(MockInjector.alter_shadow_table_query(alteration))
  end

  def capture_migration_queries(injector, initial_messages, queries, version) do
    [first_cap | rest_cap] =
      Enum.flat_map(queries, fn
        sql when is_binary(sql) -> [sql]
        {:capture, sql} -> [sql]
        _other -> []
      end)
      |> Enum.map(&capture_ddl_query/1)

    # the initial message triggers the ddl and version capture process
    # and is the last thing sent
    [{direction, msg} | _] = initial_messages

    final_msg =
      case {direction, msg} do
        {:client, msg} -> [server: msg]
        {:server, msg} -> [client: msg]
      end

    injector = apply(__MODULE__, direction, [injector, msg, server: first_cap])

    Enum.reduce(rest_cap, injector, fn cap, injector ->
      server(injector, capture_ddl_complete(), server: cap)
    end)

    injector
    |> server(capture_ddl_complete(), server: capture_version_query(version))
    |> server(capture_version_complete(), final_msg)

    # injector = server(injector, capture_ddl_complete(), final_msg)
  end
end
