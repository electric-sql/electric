defmodule Electric.Postgres.Proxy.Injector do
  alias PgProtocol.Message, as: M
  alias Electric.Postgres.Proxy.Parser
  alias Electric.Postgres.Proxy.Injector.{Capture, Send, State}
  alias Electric.DDLX

  require Logger

  @callback capture_ddl_query(query :: binary()) :: binary()
  @callback capture_version_query(version :: binary()) :: binary()
  @callback migration_version() :: binary()

  @type t() :: {Capture.t(), State.t()}
  @type msgs() :: [M.t()]
  @type response() :: {:ok, t(), backend_msgs :: msgs(), frontend_msgs :: msgs()}

  def new(opts \\ []) do
    with {:ok, loader} <- Keyword.fetch(opts, :loader) do
      injector = Keyword.get(opts, :injector, __MODULE__)
      {:ok, {nil, %State{loader: loader, injector: injector}}}
    end
  end

  @spec recv_frontend(t(), M.t() | [M.t()]) :: response()
  def recv_frontend({c, state}, msgs) do
    {c, state, send} = recv_frontend(c, state, Send.new(), msgs)

    %{front: front, back: back} = Send.flush(send)

    {:ok, {c, state}, back, front}
  end

  def recv_frontend(c, state, send, msgs) do
    Enum.reduce(List.wrap(msgs), {c, state, send}, fn msg, {c, state, send} ->
      Capture.recv_frontend(c, msg, state, send)
    end)
  end

  @spec recv_backend(t(), M.t() | [M.t()]) :: response()
  def recv_backend({c, state}, msgs) do
    {c, state, send} = recv_backend(c, state, Send.new(), msgs)

    %{front: front, back: back} = Send.flush(send)

    {:ok, {c, state}, back, front}
  end

  def recv_backend(c, state, send, msgs) do
    Enum.reduce(List.wrap(msgs), {c, state, send}, fn msg, {c, state, send} ->
      Capture.recv_backend(c, msg, state, send)
    end)
  end

  def inject_ddl_query(query, state) do
    injector = Map.fetch!(state, :injector)

    Capture.Inject.new({
      [%M.Query{query: injector.capture_ddl_query(query)}],
      [M.RowDescription, M.DataRow, M.CommandComplete, M.ReadyForQuery]
    })
  end

  def capture_ddl_query(query) do
    ~s|SELECT electric.capture_ddl('#{query}')|
  end

  def inject_version_query(version, state) do
    Logger.debug("Assigning migration tx version '#{version}'")
    injector = Map.fetch!(state, :injector)

    Capture.Inject.new({
      [%M.Query{query: injector.capture_version_query(version)}],
      [M.RowDescription, M.DataRow, M.CommandComplete, M.ReadyForQuery]
    })
  end

  def inject_version_query(state) do
    injector = Map.fetch!(state, :injector)
    version = injector.migration_version()
    {version, inject_version_query(version, state)}
  end

  def capture_version_query(version) do
    ~s|SELECT electric.migration_version('#{version}')|
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

      {true, {:drop, :index} = action} ->
        {:ok, index} = Parser.table_name(query)
        {action, State.index_electrified?(state, index), query, index}

      {true, {:electric, command} = action} ->
        {action, true, query, DDLX.Command.table_name(command)}

      {true, {:alter, :table} = action} ->
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
       wait: inject.wait,
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
end
