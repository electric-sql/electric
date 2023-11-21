defmodule Electric.Replication.Postgres.Writer do
  use GenStage

  import Electric.Postgres.Extension,
    only: [is_acked_client_lsn_relation: 1, is_extension_relation: 1]

  alias Electric.Postgres.Extension.SchemaCache
  alias Electric.Postgres.ShadowTableTransformation
  alias Electric.Replication.Changes
  alias Electric.Replication.Connectors
  alias Electric.Replication.Postgres.Client

  require Logger

  ###
  # Public interface
  ###

  def start_link(opts) do
    GenStage.start_link(__MODULE__, opts)
  end

  ###
  # GenStage callbacks
  ###

  @impl true
  def init(opts) do
    conn_config = Keyword.fetch!(opts, :conn_config)

    origin = Connectors.origin(conn_config)
    :gproc.reg(name(origin))
    Logger.metadata(origin: origin)

    # logical_publisher_position_from_lsn(state, start_lsn)
    position = 0

    {:via, :gproc, producer_name} = Keyword.fetch!(opts, :producer)
    :gproc.await(producer_name, 1_000)

    GenStage.async_subscribe(
      self(),
      [
        to: {:via, :gproc, producer_name},
        cancel: :temporary,
        starting_from: position
      ] ++ subscription_opts()
    )

    conn_opts = Connectors.get_connection_opts(conn_config)
    {:ok, conn} = Client.connect(conn_opts)

    Logger.debug(
      "#{inspect(__MODULE__)} started, registered as #{inspect(name(origin))}, subscribed to #{inspect(producer_name)}"
    )

    {:consumer, %{conn: conn, origin: origin, producer_pid: nil}}
  end

  @impl true
  def handle_subscribe(:producer, _opts, {pid, _tag}, state) do
    {:automatic, %{state | producer_pid: pid}}
  end

  @impl true
  def handle_events(events, _from, state) do
    {state, last_pos} =
      Enum.reduce(events, {state, 0}, fn {tx, pos}, {state, last_pos} ->
        case filter_extension_relations(tx) do
          %{changes: []} -> {state, last_pos}
          tx -> {send_transaction(tx, pos, state), pos}
        end
      end)

    send(state.producer_pid, {:sent_all_up_to, last_pos})

    {:noreply, [], state}
  end

  ###
  # Private functions
  ###

  defp name(name) do
    {:n, :l, {__MODULE__, name}}
  end

  defp subscription_opts do
    [min_demand: 10, max_demand: 50]
  end

  defp filter_extension_relations(%Changes.Transaction{changes: changes} = tx) do
    filtered_changes =
      Enum.reject(changes, fn %{relation: relation} ->
        if is_extension_relation(relation) and not is_acked_client_lsn_relation(relation) do
          Logger.error("Extension relation #{inspect(relation)} in the write stream")
        end

        is_extension_relation(relation) and not is_acked_client_lsn_relation(relation)
      end)

    %{tx | changes: filtered_changes}
  end

  defp send_transaction(tx, _pos, state) do
    statements = tx_changes_to_dml(tx, state)

    Client.with_transaction(state.conn, fn conn ->
      Enum.each(statements, fn stmt ->
        case :epgsql.squery(conn, stmt) do
          {:ok, 0} ->
            :ok

          error ->
            raise "Postgres.Writer failed to execute statement #{stmt} with error #{inspect(error)}"
        end
      end)
    end)

    state
  end

  defp tx_changes_to_dml(
         %Changes.Transaction{changes: changes, commit_timestamp: ts, origin: origin},
         state
       ) do
    relations = load_relations_from_changes(changes)

    changes
    |> Enum.flat_map(&preprocess_changes(state.origin, &1, relations, {ts, origin}))
    |> tap(&Logger.debug("Messages after preprocessing: #{inspect(&1, pretty: true)}"))
    |> Enum.map(&change_to_statement(&1, relations))
  end

  defp load_relations_from_changes(changes) do
    {internal_relations, user_relations} =
      changes
      |> Enum.map(& &1.relation)
      |> Enum.split_with(&is_extension_relation/1)

    internal_relations =
      internal_relations
      |> Stream.uniq()
      |> Stream.map(&SchemaCache.Global.internal_relation!/1)

    user_relations =
      user_relations
      |> ShadowTableTransformation.add_shadow_relations()
      |> Stream.uniq()
      |> Stream.map(&SchemaCache.Global.relation!/1)

    Stream.concat(internal_relations, user_relations)
    |> Map.new(fn rel -> {{rel.schema, rel.name}, rel} end)
  end

  defp preprocess_changes(origin, change, _, _) when is_extension_relation(change.relation) do
    if not is_acked_client_lsn_relation(change.relation) do
      Logger.error(
        "Change for an extension relation in the write stream. origin=#{inspect(origin)}, change = #{inspect(change, pretty: true)}"
      )
    end

    [change]
  end

  defp preprocess_changes(origin, change, relations, tag) do
    ShadowTableTransformation.split_change_into_main_and_shadow(change, relations, tag, origin)
  end

  defp change_to_statement(%Changes.NewRecord{record: data, relation: table}, relations) do
    {table_schema, table_name} = table
    columns = relations[table].columns

    table_sql = quote_ident(table_schema, table_name)
    columns_sql = map_join(columns, &quote_ident(&1.name))

    values_sql =
      column_values(data, columns)
      |> map_join(fn {val, type} -> encode_value(val, type) end)

    "INSERT INTO #{table_sql}(#{columns_sql}) VALUES (#{values_sql})"
  end

  # TODO: Should probably have backfilling of columns with defaults/nulls
  defp column_values(record, columns) do
    Enum.map(columns, &{Map.fetch!(record, &1.name), &1.type})
  end

  defp encode_value(nil, _type), do: "NULL"

  defp encode_value("t", :bool), do: "true"
  defp encode_value("f", :bool), do: "false"

  defp encode_value(val, float_type) when float_type in [:float4, :float8] do
    case Float.parse(val) do
      :error ->
        # val must be an infinity or NaN
        quote_string(val)

      {_, ""} ->
        val
    end
  end

  defp encode_value(val, int_type) when int_type in [:int2, :int4, :int8], do: val

  # All remaning types that we support are inserted as literal strings into the statement. Postgres will perform all the
  # necessary type casts.
  defp encode_value(str, _type), do: quote_string(str)

  defp quote_ident(name) do
    ~s|"#{escape_quotes(name, ?")}"|
  end

  defp quote_ident(schema, name) do
    ~s|"#{escape_quotes(schema, ?")}"."#{escape_quotes(name, ?")}"|
  end

  defp quote_string(str) do
    ~s|'#{escape_quotes(str, ?')}'|
  end

  defp escape_quotes(str, q) do
    :binary.replace(str, <<q>>, <<q, q>>, [:global])
  end

  defp map_join(list, fun) do
    list |> Enum.map(fun) |> Enum.join(",")
  end
end
