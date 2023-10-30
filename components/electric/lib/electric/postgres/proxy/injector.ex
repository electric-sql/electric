defmodule Electric.Postgres.Proxy.Injector do
  alias PgProtocol.Message, as: M
  alias Electric.Postgres.Proxy.Injector
  alias Electric.Postgres.Proxy.Injector.{Operation, Send, State}

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

  @callback capture_ddl_query(query :: binary()) :: binary()
  @callback capture_version_query(version :: binary(), priority :: integer()) :: binary()
  @callback alter_shadow_table_query(table_modification()) :: binary()
  @callback migration_version() :: binary()

  @default_mode {Injector.Electric, []}

  def new(opts \\ [], connection) do
    with {:ok, loader} <- Keyword.fetch(opts, :loader) do
      query_generator = Keyword.get(opts, :query_generator, __MODULE__)

      capture_mode_opts = Keyword.get(opts, :capture_mode, [])

      default = Keyword.get(capture_mode_opts, :default, @default_mode)
      per_user = Keyword.get(capture_mode_opts, :per_user, %{})

      session_id = Keyword.get(connection, :session_id, 0)

      mode = Map.get(per_user, connection[:username], default)

      capture =
        mode
        |> default_capture_mode()
        |> initialise_capture_mode(connection)

      Logger.info("Initialising injector in capture mode #{inspect(capture || "default")}")

      {:ok,
       {
         [capture],
         %State{loader: loader, query_generator: query_generator, session_id: session_id}
       }}
    end
  end

  defp default_capture_mode(nil) do
    @default_mode
  end

  defp default_capture_mode(module) when is_atom(module) do
    {module, []}
  end

  defp default_capture_mode({module, params})
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
    case state do
      %{pending_messages: []} -> {msgs, state}
      %{pending_messages: pending} -> {pending ++ msgs, %{state | pending_messages: []}}
    end
    |> sync_messages()
  end

  defp sync_messages({msgs, state}) do
    {out, pending} =
      Enum.flat_map_reduce(msgs, [], fn %type{} = msg, buf ->
        if type in [M.Sync, M.Flush, M.Query] do
          {[Enum.reverse([msg | buf])], []}
        else
          {[], [msg | buf]}
        end
      end)

    {List.flatten(out), %{state | pending_messages: Enum.reverse(pending)}}
  end

  def recv_client({stack, state}, msgs) do
    # combat tcp packet fragmentation by grouping messages as they would
    # probably be grouped by the client, i.e. the extended protocol messages
    # would include a Sync or Flush message
    {msgs, state} = client_messages_in(msgs, state)

    Logger.debug("recv_client: #{inspect_stack(stack)}")

    {stack, state} = Operation.recv_client(stack, msgs, state)

    {stack, state, send} = Operation.activate(stack, state, Send.new())

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
            Operation.send_error(stack, state, send)
          else
            Operation.send_client(stack, state, send)
          end

        [_ | _] ->
          Operation.recv_error(stack, errors, state, Send.client(send, errors))
      end

    %{client: client, server: server} = Send.flush(send)

    {:ok, {stack, state}, server, client}
  end

  @spec capture_ddl_query(String.t(), String.t() | nil) :: String.t()
  def capture_ddl_query(query, quote_delimiter \\ nil) do
    ~s|CALL electric.capture_ddl(#{quote_query(query, quote_delimiter)})|
  end

  @spec capture_version_query(String.t(), integer(), String.t() | nil) :: String.t()
  def capture_version_query(version, priority, quote_delimiter \\ nil)
      when is_integer(priority) do
    ~s|CALL electric.assign_migration_version(#{quote_query(version, quote_delimiter)}, #{priority})|
  end

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

  defp quote_query(query, delimiter) do
    delimiter = delimiter || random_delimiter()

    delimiter <> to_string(query) <> delimiter
  end

  defp random_delimiter do
    "$__" <> (:crypto.strong_rand_bytes(6) |> Base.encode16(case: :lower)) <> "__$"
  end

  def migration_version do
    DateTime.utc_now()
    |> Calendar.strftime("%Y%m%d%H%M%S_%f")
  end
end
