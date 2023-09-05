defmodule Electric.Postgres.Proxy.Injector do
  alias PgProtocol.Message, as: M
  alias Electric.Postgres.Proxy.Parser
  alias Electric.Postgres.Proxy.Injector.{Capture, Send, State}
  alias Electric.DDLX

  require Logger

  @callback capture_ddl_query(query :: binary()) :: binary()
  @callback capture_version_query(version :: binary()) :: binary()
  @callback migration_version() :: binary()

  @type state() :: {Capture.t(), State.t()}
  @type msgs() :: [M.t()]
  @type response() :: {:ok, state(), backend_msgs :: msgs(), frontend_msgs :: msgs()}

  def new(opts \\ []) do
    with {:ok, loader} <- Keyword.fetch(opts, :loader) do
      injector = Keyword.get(opts, :injector, __MODULE__)
      capture = Keyword.get(opts, :capture_mode, nil) |> default_capture_mode()

      Logger.debug("Initialising injector in capture mode #{inspect(capture || "default")}")

      {:ok, {capture, %State{loader: loader, injector: injector}}}
    end
  end

  defp default_capture_mode(nil) do
    nil
  end

  defp default_capture_mode(module) when is_atom(module) do
    struct(module)
  end

  defp default_capture_mode({module, params})
       when is_atom(module) and (is_list(params) or is_map(params)) do
    struct(module, params)
  end

  @spec recv_frontend(state(), M.t() | [M.t()]) :: response()
  def recv_frontend({c, state}, msgs) do
    {c, state, send} = recv_frontend(c, state, Send.new(), msgs)

    %{front: front, back: back} = Send.flush(send)

    {:ok, {c, state}, back, front}
  end

  def recv_frontend(c, state, send, msgs) do
    Enum.reduce(List.wrap(msgs), {c, state, send}, fn msg, {c, state, send} ->
      # dbg(front: msg)
      Capture.recv_frontend(c, msg, state, send)
    end)
  end

  @spec recv_backend(state(), M.t() | [M.t()]) :: response()
  def recv_backend({c, state}, msgs) do
    {c, state, send} = recv_backend(c, state, Send.new(), msgs)

    %{front: front, back: back} = Send.flush(send)

    {:ok, {c, state}, back, front}
  end

  def recv_backend(c, state, send, msgs) do
    Enum.reduce(List.wrap(msgs), {c, state, send}, fn msg, {c, state, send} ->
      # dbg(back: msg)
      Capture.recv_backend(c, msg, state, send)
    end)
  end

  def inject_ddl_query(query, state) do
    injector = Map.fetch!(state, :injector)

    Capture.Inject.new([%M.Query{query: injector.capture_ddl_query(query)}])
  end

  def capture_ddl_query(query, quote \\ nil) do
    ~s|CALL electric.capture_ddl(#{quote_query(query, quote)})|
  end

  def inject_version_query(version, state) do
    Logger.debug("Assigning migration tx version '#{version}'")
    injector = Map.fetch!(state, :injector)

    Capture.Inject.new([%M.Query{query: injector.capture_version_query(version)}])
  end

  def inject_version_query(state) do
    injector = Map.fetch!(state, :injector)
    version = injector.migration_version()
    {version, inject_version_query(version, state)}
  end

  def capture_version_query(version, quote \\ nil) do
    ~s|CALL electric.migration_version(#{quote_query(version, quote)})|
  end

  defp quote_query(query, quote) do
    quote = quote || random_quote()

    quote <> to_string(query) <> quote
  end

  defp random_quote do
    "$__" <> (:crypto.strong_rand_bytes(6) |> Base.encode16(case: :lower)) <> "__$"
  end

  def migration_version do
    DateTime.utc_now()
    |> Calendar.strftime("%Y%m%d%H%M%S_%f")
  end

  def electrified_migration?(msg, %State{} = state) do
    query = message_query(msg)

    case Parser.capture?(query) do
      {true, :begin} ->
        :begin

      {true, :commit} ->
        :commit

      {true, :rollback} ->
        :rollback

      {true, {:drop, "index"} = action} ->
        {:ok, index} = Parser.table_name(query)
        {action, State.index_electrified?(state, index), query, index}

      {true, {:electric, command} = action} ->
        {action, true, query, DDLX.Command.table_name(command)}

      {true, {:alter, "table"} = action} ->
        # To handle the alter table enable electric we need to intercept this special syntax before
        # it reaches the pg_query parser

        case Electric.DDLX.Parse.Parser.parse(query) do
          nil ->
            {:ok, table} = Parser.table_name(query)

            {action, State.table_electrified?(state, table), query, table}

          {:ok, [%DDLX.Command.Enable{}] = command} ->
            {{:electric, command}, false, query, DDLX.Command.table_name(command)}

          {:ok, [%DDLX.Command.Disable{}] = command} ->
            {{:electric, command}, true, query, DDLX.Command.table_name(command)}

          {:error, error} ->
            {{:electric, error}, false, query, nil}
        end

      {true, action} ->
        {:ok, table} = Parser.table_name(query)

        {action, State.table_electrified?(state, table), query, table}

      false ->
        false
    end
  end

  def migration_version_query?(msg, %State{} = _state) do
    query = message_query(msg)

    if Parser.insert?(query) do
      {:ok, ast} = Parser.parse(query)
      {:ok, table} = Parser.table_name(ast)

      case msg do
        # with a query we can simply extract the version from the query
        %M.Query{} ->
          {:ok, cols} = Parser.column_values_map(ast)

          case table do
            {"public", "schema_migrations"} ->
              {:ok, version} = Map.fetch(cols, "version")
              {true, version, guess_framework(msg, table), table, cols}

            _ ->
              false
          end

        # for a parse, we need to wait for the %Bind{} message
        %M.Parse{} ->
          {:ok, cols} = Parser.column_map(ast)

          case {guess_framework(msg, table), table} do
            {:ecto, {"public", "schema_migrations"}} ->
              {true, nil, :ecto, table, cols}

            {:unknown, {"public", "schema_migrations"}} ->
              {true, nil, :generic, table, cols}

            _ ->
              false
          end
      end
    else
      false
    end
  end

  def assign_generated_version(msgs, state, send, opts \\ []) when is_list(msgs) do
    direction = Keyword.get(opts, :direction, :back)
    autocommit = Keyword.get(opts, :autocommit, true)

    {version, inject} = inject_version_query(state)

    default_after_fun =
      if autocommit,
        do: fn state, send ->
          {nil, State.commit(state), send}
        end

    after_fun = Keyword.get(opts, :after_fun, default_after_fun)

    {%Capture.Sink{
       buffer: msgs,
       direction: direction,
       after_fun: after_fun
     }, State.tx_version(state, version), Send.back(send, inject.inject)}
  end

  defp message_query(query) when is_binary(query), do: query
  defp message_query(%{query: query}) when is_binary(query), do: query

  defp guess_framework(%M.Parse{name: "ecto_" <> _}, _table) do
    Logger.debug("Detected framework: ecto")
    :ecto
  end

  defp guess_framework(_msg, _table), do: :unknown

  # Validates a ddl statement to ensure that it's doing something
  # to an electrified table that we support.
  def is_valid_migration(query) do
    query
    |> Electric.Postgres.parse!()
    |> Enum.reduce_while(:ok, &check_migration_stmt(&1, &2, query))
  end

  defp check_migration_stmt(%PgQuery.AlterTableStmt{cmds: cmds}, :ok, query) do
    Enum.reduce_while(cmds, :ok, fn
      %{node: {:alter_table_cmd, %{subtype: :AT_AddColumn} = cmd}}, _acc ->
        %{def: %{node: {:column_def, coldef}}} = cmd
        check_valid_column(coldef, query)
    end)
    |> then(fn
      :ok -> {:cont, :ok}
      {:error, _} = error -> {:halt, error}
    end)
  end

  @valid_types for t <- Electric.Satellite.Serialization.supported_pg_types(), do: to_string(t)

  defp check_valid_column(%PgQuery.ColumnDef{} = coldef, query) do
    %{name: type} = Electric.Postgres.Schema.AST.map(coldef.type_name)

    if type in @valid_types do
      {:cont, :ok}
    else
      {:halt,
       {:error,
        %M.ErrorResponse{
          code: "00000",
          severity: "ERROR",
          message: "Cannot add column of type #{inspect(type)}",
          detail:
            "Electric only supports a subset of Postgres column types. Supported column types are: #{Enum.join(@valid_types, ", ")}",
          query: query
        }}}
    end
  end
end
