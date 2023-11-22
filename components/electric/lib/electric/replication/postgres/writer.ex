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

  # Public interface

  # @spec start_link([opts(), ...]) :: GenServer.on_start()
  def start_link(opts) do
    GenStage.start_link(__MODULE__, opts)
  end

  @spec get_name(String.t()) :: Electric.reg_name()
  def get_name(name) do
    {:via, :gproc, name(name)}
  end

  # @spec get_slot_reg(slot_name()) :: Electric.reg_name()
  def get_slot_reg(slot_name) do
    {:via, :gproc, name({:slot_name, slot_name})}
  end

  defp name(name) do
    {:n, :l, {__MODULE__, name}}
  end

  defp subscription_opts() do
    [min_demand: 10, max_demand: 50]
  end

  # @spec stop(server) :: :ok
  def stop(server) do
    GenStage.stop(server)
  end

  # Server callbacks

  @impl true
  def init(opts) do
    conn_config = Keyword.fetch!(opts, :conn_config)
    {:via, :gproc, producer_name} = Keyword.fetch!(opts, :producer)

    origin = Connectors.origin(conn_config)
    slot = "<SlotServer.slot>"

    :gproc.reg(name(origin))
    :gproc.reg(name({:slot_name, slot}))

    Logger.metadata(origin: origin, pg_slot: slot)

    Logger.debug(
      "slot server started, registered as #{inspect(name(origin))} and #{inspect(name({:slot_name, slot}))}"
    )

    # logical_publisher_position_from_lsn(state, start_lsn)
    position = 0

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
    {:ok, [], []} = :epgsql.squery(conn, "SET electric.session_replication_role = replica")

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
    Logger.debug(fn ->
      "Will send #{length(tx.changes)} to subscriber: #{inspect(tx.changes, pretty: true)}"
    end)

    # {wal_messages, relations, new_lsn} = convert_to_wal(tx, state)
    statements = convert_tx_to_statements(tx, state)

    Client.with_transaction(state.conn, fn conn ->
      Enum.each(statements, &(:epgsql.squery(conn, &1) |> IO.inspect()))
    end)

    state

    # %State{
    #   state
    #   | current_lsn: new_lsn,
    #     sent_relations: relations,
    #     current_source_position: pos
    # }
  end

  defp convert_tx_to_statements(
         %Changes.Transaction{commit_timestamp: ts, changes: changes, origin: origin},
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

    table_sql = ~s|"#{table_schema}"."#{table_name}"|
    columns_sql = Enum.map(columns, &~s|"#{&1.name}"|) |> Enum.join(",")
    values_sql = record_to_tuple(data, columns) |> Enum.map(&encode_value/1) |> Enum.join(",")

    "INSERT INTO #{table_sql}(#{columns_sql}) VALUES (#{values_sql})" |> IO.inspect()
  end

  defp change_to_statement(%Changes.UpdatedRecord{relation: table, record: new}, relations) do
    {table_schema, table_name} = table

    columns = relations[table].columns
    pk_columns = columns |> Enum.filter(& &1.part_of_identity?) |> Enum.map(& &1.name)

    table_sql = ~s|"#{table_schema}"."#{table_name}"|

    assignments_sql =
      Enum.map(new, fn {col_name, val} ->
        ~s|"#{col_name}" = #{encode_value(val)}|
      end)
      |> Enum.join(",")

    where_sql =
      Map.take(new, pk_columns)
      |> Enum.map(fn {col_name, val} ->
        ~s|"#{col_name}" = #{encode_value(val)}|
      end)
      |> Enum.join(" AND ")

    "UPDATE #{table_sql} SET #{assignments_sql} WHERE #{where_sql}" |> IO.inspect()
  end

  defp change_to_statement(%Changes.DeletedRecord{relation: table, old_record: old}, relations) do
    {table_schema, table_name} = table

    columns = relations[table].columns
    pk_columns = columns |> Enum.filter(& &1.part_of_identity?) |> Enum.map(& &1.name)

    table_sql = ~s|"#{table_schema}"."#{table_name}"|

    where_sql =
      Map.take(old, pk_columns)
      |> Enum.map(fn {col_name, val} ->
        ~s|"#{col_name}" = #{encode_value(val)}|
      end)
      |> Enum.join(" AND ")

    "DELETE FROM #{table_sql} WHERE #{where_sql}" |> IO.inspect()
  end

  # TODO: Should probably have backfilling of columns with defaults/nulls
  defp record_to_tuple(record, columns) do
    Enum.map(columns, &Map.fetch!(record, &1.name))
  end

  defp encode_value(nil), do: "NULL"
  defp encode_value(str) when is_binary(str), do: "'" <> String.replace(str, "'", "''") <> "'"
  defp encode_value(val), do: val
end
