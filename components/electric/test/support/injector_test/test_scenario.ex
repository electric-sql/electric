defmodule Electric.Postgres.Proxy.TestScenario do
  alias PgProtocol.Message, as: M
  alias Electric.Postgres.Proxy.Injector
  alias Electric.DDLX
  alias Electric.Satellite.SatPerms

  alias ElectricTest.PermissionsHelpers.Perms

  import ExUnit.Assertions

  defmodule MockInjector do
    alias Electric.Postgres.Proxy.Injector

    @behaviour Electric.Postgres.Proxy.Injector

    def proxy_sql(command, ddl) do
      DDLX.Command.proxy_sql(command, ddl, &quote_query/1)
    end

    @impl true
    def introspect_tables_query(tables) do
      Injector.introspect_tables_query(tables, "'")
    end

    @impl true
    def lock_rules_table_query do
      Injector.lock_rules_table_query()
    end

    @impl true
    def electrified_tables_query do
      Injector.electrified_tables_query()
    end

    @impl true
    def permissions_rules_query do
      Injector.permissions_rules_query()
    end

    @impl true
    def save_permissions_rules_query(rules) do
      Injector.save_permissions_rules_query(rules)
    end

    @impl true
    def capture_ddl_query(query) do
      Injector.capture_ddl_query(query, "$query$")
    end

    def capture_version_query() do
      capture_version_query(migration_version(), 0)
    end

    def capture_version_query(priority) when is_integer(priority) do
      capture_version_query(migration_version(), priority)
    end

    def capture_version_query(version) when is_binary(version) do
      capture_version_query(version, 0)
    end

    @impl true
    def capture_version_query(version, priority) do
      Injector.capture_version_query(version, priority, "$query$")
    end

    @impl true
    def alter_shadow_table_query(alteration) do
      Injector.alter_shadow_table_query(alteration, "$query$")
    end

    @impl true
    def activate_write_mode_query({_, _} = relation) do
      Injector.activate_write_mode_query(relation, "$$")
    end

    @impl true
    def quote_query(query) do
      Injector.quote_query(query, "$query$")
    end

    @impl true
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
      alias Electric.Postgres.Proxy.Injector

      alias ElectricTest.PermissionsHelpers.Perms

      unquote(message_aliases)

      import unquote(m)
    end
  end

  @scenarios [
    __MODULE__.Framework,
    __MODULE__.FrameworkSimple,
    __MODULE__.Manual,
    __MODULE__.AdHoc,
    __MODULE__.ManualTx,
    __MODULE__.ExtendedNoTx
  ]

  @frameworks [
    Electric.Proxy.InjectorTest.EctoFramework
  ]

  def scenarios, do: @scenarios
  def frameworks, do: @frameworks

  def query(sql) when is_binary(sql) do
    %M.Query{query: sql}
  end

  def query(%M.Query{} = query) do
    query
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
  end

  def parse_describe(sql, name \\ "") do
    # would love to assert that the parse and describe messages
    # are passed as-is but getting the double incantations of this to work
    # and return the same names is tricky, and it's not **that** important
    # name = name || random_name()

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

  def parse_describe_sync(sql, name \\ "") do
    # would love to assert that the parse and describe messages
    # are passed as-is but getting the double incantations of this to work
    # and return the same names is tricky, and it's not **that** important
    # name = name || random_name()

    [
      # putting the close here makes the tests difficult -- 
      # because we can only really respond to the parse message
      # any close->closecomplete pair should just come through the system
      # (client->server->client) untouched
      # %M.Close{type: "S", name: name},
      %M.Parse{query: sql, name: name},
      %M.Describe{name: name},
      %M.Sync{}
    ]
  end

  # defp _random_name() do
  #   "query_#{:crypto.strong_rand_bytes(4) |> Base.encode16(case: :lower)}"
  # end

  def parse_describe_complete(params \\ []) do
    [
      # %M.CloseComplete{},
      %M.ParseComplete{},
      struct(%M.ParameterDescription{}, params),
      %M.NoData{}
    ]
  end

  def parse_describe_sync_complete(status) do
    [
      %M.ParseComplete{},
      %M.ParameterDescription{},
      %M.RowDescription{},
      %M.ReadyForQuery{status: status}
    ]
  end

  def close do
    %M.Close{}
  end

  def close_complete do
    %M.CloseComplete{}
  end

  def sync do
    %M.Sync{}
  end

  def bind_execute() do
    bind_execute("", [])
  end

  def bind_execute(name, params \\ []) do
    source = Keyword.get(params, :source, "")
    bind_params = Keyword.get(params, :bind, [])

    [
      struct(
        %M.Bind{
          portal: name,
          source: source,
          parameter_format_codes: [],
          parameters: [],
          result_format_codes: []
        },
        bind_params
      ),
      %M.Execute{portal: name, max_rows: 0},
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

  def introspect_result(ddl, status \\ :tx) do
    Enum.concat([
      [%M.RowDescription{}],
      ddl |> List.wrap() |> Enum.map(&%M.DataRow{fields: [&1]}),
      complete_ready("SELECT #{length(List.wrap(ddl))}", status)
    ])
  end

  def electrified_tables_result do
    electrified_tables_result([], :tx)
  end

  def electrified_tables_result(tables, status \\ :tx) when is_list(tables) do
    Enum.concat([
      [%M.RowDescription{}],
      tables
      |> Enum.map(fn
        {_, _} = relation -> relation
        name when is_binary(name) -> Electric.Postgres.NameParser.parse!(name)
      end)
      |> Enum.map(fn {sname, tname} -> %M.DataRow{fields: [sname, tname]} end),
      complete_ready("SELECT #{length(tables)}", status)
    ])
  end

  def proxy_sql(command, ddl) do
    MockInjector.proxy_sql(command, ddl)
  end

  def quote_query(query) do
    MockInjector.quote_query(query)
  end

  def capture_version_query() do
    query(MockInjector.capture_version_query())
  end

  def capture_version_query(version_or_priority) do
    query(MockInjector.capture_version_query(version_or_priority))
  end

  def capture_version_query(version, priority) do
    query(MockInjector.capture_version_query(to_string(version), priority))
  end

  def lock_rules_table_query do
    query(MockInjector.lock_rules_table_query())
  end

  def introspect_tables_query(tables) do
    query(MockInjector.introspect_tables_query(tables))
  end

  def permissions_rules_query do
    query(MockInjector.permissions_rules_query())
  end

  def save_permissions_rules_query(rules) do
    query(MockInjector.save_permissions_rules_query(rules))
  end

  def electrified_tables_query do
    query(MockInjector.electrified_tables_query())
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

  def modifies_permissions?([_ | _] = cmds) do
    Enum.any?(cmds, &modifies_permissions?/1)
  end

  def modifies_permissions?(%Electric.DDLX.Command{action: cmd}) do
    modifies_permissions?(cmd)
  end

  def modifies_permissions?(%SatPerms.DDLX{} = ddlx) do
    Enum.any?(
      ddlx
      |> DDLX.Command.command_list()
      |> Enum.to_list(),
      &modifies_permissions?/1
    )
  end

  def modifies_permissions?(%DDLX.Command.Enable{}) do
    false
  end

  def modifies_permissions?(%DDLX.Command.Disable{}) do
    false
  end

  def modifies_permissions?(%DDLX.Command.Error{}) do
    false
  end

  def modifies_permissions?(%SatPerms.Sqlite{}) do
    false
  end

  def modifies_permissions?(%m{})
      when m in [SatPerms.Grant, SatPerms.Revoke, SatPerms.Assign, SatPerms.Unassign] do
    true
  end

  # splitting this out as a function in order to simplify the process of
  # updating the expected messages when calling an electric procedure
  def electric_call_complete(status \\ :tx) do
    [
      %M.CommandComplete{tag: "CALL"},
      %M.ReadyForQuery{status: status}
    ]
  end

  def state({_stack, state}) do
    state
  end

  def tx({_stack, %{tx: nil}}) do
    raise "No active transaction"
  end

  def tx({_stack, %{tx: tx}}) do
    tx
  end

  def permissions_modified!({_stack, state}) do
    if rules = Injector.State.permissions_modified(state) do
      {_initial, final_rules} = rules
      final_rules
    else
      raise("permissions are not modified")
    end
  end

  @doc """
  Asserts that the injector is in the idle state, so outside a transaction
  with no active capture mode.
  """
  def idle!(injector, operator \\ Electric.Postgres.Proxy.Injector.Electric)

  def idle!({[%op{}], state} = injector, op) do
    refute Injector.State.tx?(state)
    injector
  end

  def idle!({capture, state}, op) do
    flunk(
      "Message sequence ended with pending capture state:\ncapture: #{inspect(capture)}\ntx: #{inspect(state.tx)}, expected #{inspect(op)}"
    )
  end

  @doc """
  Encapsulates the series of query-response messages issued by
  `Operation.Electric` in order to introspect the db before allowing a DDLX
  command.
  """
  def electric_preamble(injector, initial_messages, command, electrified_tables \\ []) do
    tables = Electric.DDLX.Command.table_names(command)
    introspect_query = introspect_tables_query(tables)

    injector
    |> command(initial_messages, server: lock_rules_table_query())
    |> server(complete_ready("LOCK TABLE"), server: electrified_tables_query())
    |> server(electrified_tables_result(electrified_tables), server: introspect_query)
  end

  def electric_begin(injector) do
    electric_begin(injector, client: begin())
  end

  def electric_begin(injector, initial_messages, opts \\ []) do
    rules =
      case Keyword.fetch(opts, :rules) do
        {:ok, rules} ->
          rules

        :error ->
          nil
      end

    {injector, final_messages} =
      case initial_messages do
        [client: "BEGIN"] ->
          {client(injector, begin(), server: begin()), client: complete_ready("BEGIN", :tx)}

        [client: %M.Query{query: "BEGIN"} = msg] ->
          {client(injector, msg, server: begin()), client: complete_ready("BEGIN", :tx)}

        [client: [%M.Query{query: "BEGIN"}] = msgs] ->
          {client(injector, msgs, server: begin()), client: complete_ready("BEGIN", :tx)}

        [client: msgs] ->
          final =
            case Keyword.fetch(opts, :client) do
              {:ok, msgs} ->
                [client: msgs]

              :error ->
                [server: Keyword.get(opts, :server, msgs)]
            end

          {client(injector, msgs, server: begin()), final}
      end

    injector
    |> server(complete_ready("BEGIN", :tx), server: permissions_rules_query())
    |> server(rules_query_result(rules), final_messages)
  end

  @doc """
  If the transaction has unwritten permissions updates, then they are written here.
  """
  def electric_commit({_stack, state} = injector, initial_messages, final_messages \\ nil) do
    version? = Injector.State.capture_version?(state)

    [state_msg | state_messages] =
      if rules = Injector.State.permissions_modified(state) do
        {_initial, final_rules} = rules

        [
          save_permissions_rules_query(final_rules),
          if(version?, do: capture_version_query(), else: []),
          commit()
        ]
      else
        [
          if(version?, do: capture_version_query(), else: []),
          commit()
        ]
      end
      |> List.flatten()

    injector = command(injector, initial_messages, server: state_msg)

    commit_complete = complete_ready("COMMIT", :idle)
    final_messages = final_messages || [client: commit_complete]

    state_messages
    |> Enum.reduce(injector, fn msg, injector ->
      server(injector, complete_ready("INSERT 1", :tx), server: msg)
    end)
    |> server(commit_complete, final_messages)
  end

  def rules_query_result() do
    rules_query_result(nil)
  end

  def rules_query_result(nil) do
    rules_query_result(%SatPerms.Rules{id: 1})
  end

  def rules_query_result(%SatPerms.Rules{} = rules) do
    rules_data = rules |> Protox.encode!() |> IO.iodata_to_binary()

    [
      %M.RowDescription{},
      %M.DataRow{fields: [rules_data]}
      | complete_ready("SELECT 1", :tx)
    ]
  end

  def default_rules do
    Perms.to_rules([])
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
  def electric(injector, initial_messages, command, ddl, final_messages) do
    capture_ddl = List.wrap(ddl)

    # the initial client message which is a [bind, execute] or [query] message
    # triggers a re-write to the real procedure call

    injector = electric_preamble(injector, initial_messages, command)

    case proxy_sql(command, capture_ddl) |> Enum.map(&query/1) do
      [] ->
        # if the electric command doesn't result in any immediate queries, then
        # we're done, pending the final message from the preamble introspection
        # queries
        server(injector, introspect_result(ddl), final_messages)

      [query | queries] ->
        injector = server(injector, introspect_result(ddl), server: query)

        # this real proc call returns a readyforquery etc response which triggers
        # the next procedure call required for the electric command
        Enum.reduce(queries, injector, fn query, injector ->
          server(injector, electric_call_complete(), server: query)
        end)
        # on receipt of the last readyforquery, the injector returns
        # the required message sequence that the client is expecting for
        # it's initial `ELECTRIC ...` query
        |> server(electric_call_complete(), final_messages)
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
  def server(injector, server_messages, recipients) do
    command(injector, [server: server_messages], recipients)
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
  def client(injector, client_messages, recipients) do
    command(injector, [client: client_messages], recipients)
  end

  def command(injector, msgs, recipients) do
    {:ok, injector, proxy_server, proxy_client} =
      case msgs do
        [client: client_msgs] ->
          Injector.recv_client(injector, to_struct(client_msgs))

        [server: server_msgs] ->
          Injector.recv_server(injector, to_struct(server_msgs))
      end

    final =
      case recipients do
        fun when is_function(fun) ->
          fun.(injector)

        list when is_list(list) ->
          list
      end

    expected_proxy_server = Keyword.get(final, :server, []) |> to_struct()
    expected_proxy_client = Keyword.get(final, :client, []) |> to_struct()

    assert_messages_equal(
      proxy_server: {proxy_server, expected_proxy_server},
      proxy_client: {proxy_client, expected_proxy_client}
    )

    injector
  end

  defp assert_messages_equal(messages) do
    for {_direction, {sent, expected}} <- messages do
      if length(sent) != length(expected) do
        assert_unequal(messages)
      end

      for {s, e} <- Enum.zip(sent, expected) do
        equals? =
          case e do
            # special case error  and notice messages -- I don't want to validate the
            # fields in this case, it's enough to know that the response was of the correct type
            %m{} when m in [M.ErrorResponse, M.NoticeResponse] -> is_struct(s, m)
            m -> m == s
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

  defp to_struct_internal(sql) when is_binary(sql) do
    query(sql)
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
    :rand.uniform(999_999_999_999) |> to_string()
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
          {:ok, command} = DDLX.parse(query)
          command
      end

    ddl = Keyword.get(opts, :ddl, "")

    injector
    |> electric([client: query(query)], command, ddl,
      client: complete_ready(DDLX.Command.tag(command))
    )
  end

  def execute_tx_sql({:capture, {query, opts}}, injector, :simple) do
    tag = random_tag()

    injector
    |> client(query(query), server: query(query))
    |> server(complete_ready(tag),
      server: capture_ddl_query(query),
      client: [
        capture_notice(query)
      ]
    )
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
          {:ok, command} = DDLX.parse(query)
          command
      end

    ddl = Keyword.get(opts, :ddl, "")

    injector
    |> client(parse_describe(query), client: parse_describe_complete(), server: [])
    |> electric([client: bind_execute()], command, ddl,
      client: bind_execute_complete(DDLX.Command.tag(command))
    )
  end

  def execute_tx_sql({:capture, {query, opts}}, injector, :extended) do
    tag = random_tag()

    injector
    |> client(parse_describe(query), server: parse_describe(query))
    |> server(parse_describe_complete())
    |> client(bind_execute())
    |> server(bind_execute_complete(tag),
      server: capture_ddl_query(query),
      client: [
        capture_notice(query)
      ]
    )
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
    query(MockInjector.alter_shadow_table_query(alteration))
  end

  def activate_write_mode_query({_, _} = relation) do
    query(MockInjector.activate_write_mode_query(relation))
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
  end
end
