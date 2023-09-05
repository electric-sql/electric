defprotocol Electric.Postgres.Proxy.Injector.Capture do
  alias PgProtocol.Message, as: M
  alias Electric.Postgres.Proxy.Injector.{Send, State}

  @type result() :: {t(), State.t(), Send.t()}
  @spec recv_frontend(t(), M.t(), State.t(), Send.t()) :: result()
  def recv_frontend(capture, msg, state, send)

  @spec recv_backend(t(), M.t(), State.t(), Send.t()) :: {t(), State.t(), Send.t()}
  def recv_backend(capture, msg, state, send)
end

defimpl Electric.Postgres.Proxy.Injector.Capture, for: Atom do
  alias PgProtocol.Message, as: M
  alias Electric.Postgres.Proxy.{Injector, Parser}
  alias Electric.Postgres.Proxy.Injector.{Send, State}
  alias Electric.Postgres.Proxy.Injector.Capture
  alias Electric.Postgres.Proxy.Injector.Capture.{AutoTx, Migration, Version}

  require Logger

  def recv_frontend(nil, %m{} = msg, state, send) when m in [M.Parse, M.Query] do
    # does the query affect an electrified table?
    action = Injector.electrified_migration?(msg, state)

    case {action, State.tx?(state)} do
      {:begin, _} ->
        # start of tx
        {nil, State.begin(state), Send.back(send, msg)}

      {:rollback, true} ->
        {nil, State.rollback(state), Send.back(send, msg)}

      {:rollback, false} ->
        Logger.warning("Got rollback when injector was not in a transaction")
        {nil, State.rollback(state), Send.back(send, msg)}

      {action, true} ->
        # in tx, standard action
        handle_frontend(action, msg, state, send)

      {_action, false} ->
        # not in tx, but attempting to do something -- wrap everything in a tx
        Logger.debug("Starting AutoTx with msg #{inspect(msg)}")
        AutoTx.begin(msg, state, send)
    end
  end

  def recv_frontend(nil, msg, state, send) do
    {nil, state, Send.back(send, msg)}
  end

  def recv_backend(nil, msg, state, send) do
    # TODO: reset things after a commit/rollback
    {nil, state, Send.front(send, msg)}
  end

  defp handle_frontend(action, msg, state, send) do
    case {action, State.electrified?(state)} do
      {:commit, true} ->
        case State.tx_version(state) do
          {:ok, _version} ->
            {nil, State.commit(state), Send.back(send, msg)}

          :error ->
            # TODO: are we committing an electrified transaction without a version?
            #       if so we need to assign a made up version
            Injector.assign_generated_version([msg], state, send)
        end

      {:commit, false} ->
        {nil, State.commit(state), Send.back(send, msg)}

      {{{:alter, "table"}, electrified?, query, table}, _} ->
        handle_alter_table(msg, electrified?, query, table, state, send)

      {{{:create, "index"}, true, query, table}, _} ->
        migration_state(
          msg,
          query,
          table,
          State.electrify(state, table),
          Send.back(send, msg)
        )

      {{{:drop, "table"}, true, _query, {schema, name}}, _} ->
        error = [
          %M.ErrorResponse{
            severity: "ERROR",
            message: "Cannot DROP Electrified table \"#{schema}\".\"#{name}\"",
            detail:
              "Electric currently only supports additive migrations (ADD COLUMN, ADD INDEX)",
            schema: schema,
            table: name
          },
          %M.ReadyForQuery{status: :failed}
        ]

        {nil, state, error_response(send, error)}

      {{{:drop, "index"}, true, query, index}, _table} ->
        migration_state(msg, query, index, State.electrify(state), Send.back(send, msg))

      {{{:electric, command}, _electrified?, _query, table_name}, _} ->
        # TODO: have the command parser correctly parse names into {schema, name}
        {:ok, {_schema, _name} = table} = Electric.Postgres.Proxy.NameParser.parse(table_name)

        # we capture a version for any DDLX because it creates a new schema version
        Capture.Electrify.new(command, msg, State.electrify(state, table), send)

      # migration affecting non-electrified table
      {{_action, false, _query, _table}, _} ->
        {nil, state, Send.back(send, msg)}

      # not a migration but transaction has affected electrified tables
      {false, true} ->
        case Injector.migration_version_query?(msg, state) do
          {true, version, framework, table, columns} ->
            capture = %Version{
              version: version,
              framework: framework,
              table: table,
              columns: columns
            }

            version_state(msg, capture, state, Send.back(send, msg))

          false ->
            {nil, state, Send.back(send, msg)}
        end

      # neither electified migration nor an electrified migration tx
      {false, false} ->
        {nil, state, Send.back(send, msg)}
    end
  end

  # altering an electrified table
  defp handle_alter_table(msg, true, query, {schema, name} = table, state, send) do
    case Parser.is_additive_migration(query) do
      {:ok, true} ->
        case Injector.is_valid_migration(query) do
          :ok ->
            migration_state(
              msg,
              query,
              table,
              State.electrify(state, table),
              Send.back(send, msg)
            )

          {:error, error} ->
            msgs = [
              error,
              %M.ReadyForQuery{status: :failed}
            ]

            {nil, state, error_response(send, msgs)}
        end

      {:ok, false} ->
        error = [
          %M.ErrorResponse{
            severity: "ERROR",
            message:
              "Invalid destructive migration on Electrified table \"#{schema}\".\"#{name}\": #{query}",
            detail:
              "Electric currently only supports additive migrations (ADD COLUMN, ADD INDEX)",
            schema: schema,
            table: name
          },
          %M.ReadyForQuery{status: :failed}
        ]

        {nil, state, error_response(send, error)}
    end
  end

  # altering a non electrified table
  defp handle_alter_table(msg, false, _query, _table, state, send) do
    {nil, state, Send.back(send, msg)}
  end

  defp error_response(send, error) do
    # send the error messages and prevent any others being appended
    send
    |> Send.front(error)
    |> Send.lock()
  end

  # For the simple protocol, we can skip the intermediate %Migration{} and
  # %Version{} states because all they do is introspect the %Bind{} messages.
  #
  # The simple query protocol has all the information required for both the
  # migration and version injections in a single message, so we can just use
  # the %Inject{} state to wait for the %ReadyForQuery{} message and do the
  # actual injection.

  defp migration_state(%M.Parse{}, query, table, state, send) do
    {
      %Migration{ddl: query, table: table},
      state,
      send
    }
  end

  defp migration_state(%M.Query{}, query, _table, state, send) do
    inject = Injector.inject_ddl_query(query, state)

    {inject, state, send}
  end

  defp version_state(%M.Parse{}, version, state, send) do
    {version, state, send}
  end

  defp version_state(%M.Query{}, version, state, send) do
    inject = Injector.inject_version_query(version.version, state)

    {inject, State.tx_version(state, version.version), send}
  end
end
