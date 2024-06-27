defmodule Electric.Postgres.Proxy.Injector do
  alias PgProtocol.Message, as: M
  alias Electric.Postgres
  alias Electric.Postgres.Proxy.Injector
  alias Electric.Postgres.Proxy.Injector.{Operation, Send, State}
  alias Electric.Satellite.SatPerms

  require Logger

  @type table_modification() :: %{
          table: {String.t(), String.t()},
          action: :add,
          column: String.t(),
          type: String.t()
        }
  @type state() :: {[Operation.t()], State.t()}
  @type msgs() :: [M.t()]
  @type response() :: {:ok, state(), backend_msgs :: msgs(), frontend_msgs :: msgs()}
  @type quote_mark() :: String.t()
  @type t :: module()

  @callback quote_query(String.t()) :: String.t()
  @callback introspect_tables_query(Postgres.relation() | String.t() | [String.t()]) :: String.t()
  @callback lock_rules_table_query() :: String.t()
  @callback electrified_tables_query() :: String.t()
  @callback permissions_rules_query() :: String.t()
  @callback save_permissions_rules_query(%SatPerms.Rules{}) :: String.t()
  @callback capture_ddl_query(query :: binary()) :: String.t()
  @callback capture_version_query(version :: binary(), priority :: integer()) :: String.t()
  @callback alter_shadow_table_query(table_modification()) :: String.t()
  @callback migration_version() :: String.t()
  @callback activate_write_mode_query(Postgres.relation()) :: String.t()

  @default_mode {Injector.Electric, []}

  @behaviour __MODULE__

  def new(opts \\ [], connection) do
    with {:ok, loader} <- Keyword.fetch(opts, :loader) do
      query_generator = Keyword.get(opts, :query_generator, __MODULE__)

      capture_mode_opts = Keyword.get(opts, :capture_mode, [])

      default_injector = Keyword.get(capture_mode_opts, :default, @default_mode)

      session_id = Keyword.get(connection, :session_id, 0)

      mode =
        per_database_injector(connection) ||
          per_user_injector(capture_mode_opts, connection) ||
          default_injector

      capture =
        mode
        |> configure_capture_mode()
        |> initialise_capture_mode(connection)

      Logger.info("Initialising injector in capture mode #{inspect(capture || "default")}")

      {:ok,
       {
         [capture],
         %State{loader: loader, query_generator: query_generator, session_id: session_id}
       }}
    end
  end

  defp per_database_injector(connection) do
    case Keyword.get(connection, :database) do
      "prisma_migrate_shadow_db" <> _ = database ->
        Logger.debug("Connection to prisma shadow db: using Shadow injector")
        {Injector.Shadow, [database: database]}

      _ ->
        nil
    end
  end

  defp per_user_injector(opts, connection) do
    get_in(opts, [:per_user, connection[:username]])
  end

  defp configure_capture_mode(module) when is_atom(module) do
    {module, []}
  end

  defp configure_capture_mode({module, params})
       when is_atom(module) and (is_list(params) or is_map(params)) do
    {module, params}
  end

  defp initialise_capture_mode({module, opts}, args) do
    {:module, ^module} = Code.ensure_loaded(module)

    if function_exported?(module, :new, 1) do
      module.new(Keyword.merge(opts, args))
    else
      struct(module, opts)
    end
  end

  defp inspect_stack(stack) do
    inspect(Enum.map(stack, fn %op{} -> op end))
  end

  @spec client_messages_in([M.t()], State.t()) :: {[M.t()], State.t()}
  defp client_messages_in(msgs, state) do
    {out, still_pending} =
      case state do
        %{pending_messages: []} -> msgs
        %{pending_messages: pending} -> Stream.concat(pending, msgs)
      end
      |> sync_messages()

    {out, %{state | pending_messages: still_pending}}
  end

  # Split the list of messages at the last occurrence of any of M.Sync, M.Flush or M.Query.
  defp sync_messages(msgs) do
    {rpending, rout} =
      msgs
      |> Enum.reverse()
      |> Enum.split_while(fn %type{} -> type not in [M.Sync, M.Flush, M.Query] end)

    {Enum.reverse(rout), Enum.reverse(rpending)}
  end

  def recv_client({stack, state}, msgs) do
    # combat tcp packet fragmentation by grouping messages as they would
    # probably be grouped by the client, i.e. the extended protocol messages
    # would include a Sync or Flush message
    {msgs, state} = client_messages_in(msgs, state)

    Logger.debug("recv_client: #{inspect_stack(stack)}")

    {stack, state} = Operation.recv_client(stack, msgs, state)

    {stack, state, send} = Operation.activate(stack, state, Send.new())

    state =
      if Enum.any?(send.client, &is_struct(&1, M.ErrorResponse)) do
        State.failed(state)
      else
        state
      end

    %{client: client, server: server} = Send.flush(send)

    {:ok, {stack, state}, server, client}
  end

  def recv_server({stack, state}, msgs) do
    Logger.debug("recv_server: #{inspect_stack(stack)}")
    # handle errors from the server here so detecting errors doesn't have to be
    # done by every command
    {non_errors, errors} = Enum.split_while(msgs, &(!is_struct(&1, M.ErrorResponse)))

    {stack, state, send} =
      Enum.reduce(non_errors, {stack, state, Send.new()}, fn msg, {stack, state, send} ->
        Operation.recv_server(stack, msg, state, send)
      end)

    {stack, state, send} =
      case errors do
        [] ->
          if Enum.any?(send.client, &is_struct(&1, M.ErrorResponse)) do
            Operation.send_error(stack, State.failed(state), send)
          else
            Operation.send_client(stack, state, send)
          end

        [_ | _] ->
          Operation.recv_error(stack, errors, State.failed(state), Send.client(send, errors))
      end

    %{client: client, server: server} = Send.flush(send)

    {:ok, {stack, state}, server, client}
  end

  @impl __MODULE__
  def introspect_tables_query(names, quote_delimiter \\ nil) do
    stmts =
      names
      |> List.wrap()
      |> Enum.map(&normalise_name/1)
      |> Enum.map(&quote_query(&1, quote_delimiter))
      |> Enum.join(", ")

    "SELECT electric.introspect_tables(#{stmts});"
  end

  @impl __MODULE__
  def lock_rules_table_query do
    "LOCK TABLE #{Electric.Postgres.Extension.global_perms_table()} IN EXCLUSIVE MODE"
  end

  @impl __MODULE__
  def electrified_tables_query do
    Electric.Postgres.Extension.electrified_tables_query()
  end

  @impl __MODULE__
  def permissions_rules_query do
    Electric.Postgres.Extension.Permissions.global_rules_query()
  end

  @impl __MODULE__
  def save_permissions_rules_query(rules) do
    Electric.Postgres.Extension.Permissions.save_global_query(rules)
  end

  @impl __MODULE__
  def activate_write_mode_query({sname, tname}, quote_delimiter \\ nil) do
    "CALL electric.install_shadow_tables_and_triggers(#{quote_query(sname, quote_delimiter)}, #{quote_query(tname, quote_delimiter)})"
  end

  @impl __MODULE__
  def capture_ddl_query(stmts, quote_delimiter \\ nil)

  @spec capture_ddl_query([String.t()], String.t() | nil) :: String.t()
  def capture_ddl_query(ddlx, quote_delimiter) when is_list(ddlx) do
    stmts = ddlx |> Enum.map(&quote_query(&1, quote_delimiter)) |> Enum.join(", ")
    ~s|CALL electric.capture_ddl_array(#{stmts})|
  end

  @spec capture_ddl_query(String.t(), String.t() | nil) :: String.t()
  def capture_ddl_query(query, quote_delimiter) do
    ~s|CALL electric.capture_ddl(#{quote_query(query, quote_delimiter)})|
  end

  @impl __MODULE__
  def capture_version_query(version, priority, quote_delimiter \\ nil)
      when is_integer(priority) do
    ~s|CALL electric.assign_migration_version(#{quote_query(version, quote_delimiter)}, #{priority})|
  end

  @impl __MODULE__
  def alter_shadow_table_query(alteration) do
    alter_shadow_table_query(alteration, nil)
  end

  def alter_shadow_table_query(alteration, quote) do
    %{table: {schema, table}, action: action, column: column, type: type} = alteration

    args =
      [schema, table, action, column, type]
      |> Enum.map(&quote_query(&1, quote))
      |> Enum.join(", ")

    ~s|CALL electric.alter_shadow_table(#{args})|
  end

  @impl __MODULE__
  def quote_query(query) do
    quote_query(query, random_delimiter())
  end

  @impl __MODULE__
  def migration_version do
    Calendar.strftime(
      DateTime.utc_now(),
      "%Y%m%d%H%M%S_%f"
    )
  end

  def quote_query(query, delimiter) do
    delimiter = delimiter || random_delimiter()

    delimiter <> to_string(query) <> delimiter
  end

  def query_generator({_, %State{query_generator: query_generator}}) do
    query_generator
  end

  defp random_delimiter do
    "$__" <> (:crypto.strong_rand_bytes(6) |> Base.encode16(case: :lower)) <> "__$"
  end

  defp normalise_name({_, _} = relation) do
    Electric.Utils.inspect_relation(relation)
  end

  defp normalise_name(name) when is_binary(name) do
    name
  end
end
