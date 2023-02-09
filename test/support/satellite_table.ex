defmodule Electric.Test.SatelliteMockedClient do
  alias Electric.Test.SatelliteWsClient
  alias Electric.Replication.Changes.{Transaction, NewRecord, DeletedRecord, UpdatedRecord}

  use GenServer
  require Logger

  @moduledoc """
  """

  @spec start_replicate_table(term(), list()) :: {:ok, pid()} | {:error, term()}
  def start_replicate_table(schema, connect_opts) do
    GenServer.start_link(__MODULE__, {schema, connect_opts})
  end

  @doc """
     When strict is equal to true, return error, if the row is already present
  """
  @spec insert(pid(), term(), list(term()), boolean()) :: :ok | {:error, term()}
  def insert(server, id, values, strict \\ true) do
    GenServer.call(server, {:insert, id, values, strict})
  end

  @doc """
     When strict is equal to true, return error, if the row is not present
  """
  @spec update(pid(), term(), list(term()), boolean()) :: :ok | {:error, term()}
  def update(server, id, new_values, strict \\ true) do
    GenServer.call(server, {:update, id, new_values, strict})
  end

  @spec delete(pid(), term(), boolean()) :: :ok | {:error, term()}
  def delete(server, id, strict \\ true) do
    GenServer.call(server, {:delete, id, strict})
  end

  @spec push_changes(pid(), integer()) :: :ok | {:error, term()}
  def push_changes(server, commit_timestamp) do
    GenServer.call(server, {:push_changes, commit_timestamp})
  end

  defmodule State do
    @type t() :: %__MODULE__{
            oplog_table: :ets.tid(),
            shadow_table: :ets.tid(),
            user_table: :ets.tid(),
            last_oplog_pos: non_neg_integer(),
            last_sent_pos: non_neg_integer(),
            origin: String.t(),
            relation_id: SchemaRegistry.oid(),
            relations_mapping: %{},
            conn: pid()
          }
    defstruct oplog_table: nil,
              shadow_table: nil,
              user_table: nil,
              last_oplog_pos: 0,
              last_sent_pos: 0,
              origin: nil,
              relation_id: nil,
              relations_mapping: nil,
              conn: :origin
  end

  def init({%{schema_name: schema, table_name: table, oid: oid, columns: columns}, opts}) do
    {:ok, conn} = SatelliteWsClient.connect_and_spawn(opts)
    SatelliteWsClient.send_relation_internal(conn, schema, table, oid, columns)

    {:ok,
     %State{
       oplog_table: :ets.new(:oplog, [:ordered_set, :public]),
       shadow_table: :ets.new(:shadow, [:set, :public]),
       user_table: :ets.new(:user_t, [:set, :public]),
       relation_id: {schema, table},
       relations_mapping: %{
         {schema, table} => {oid, Enum.map(columns, fn %{name: name} -> name end)}
       },
       origin: Keyword.get(opts, :id),
       conn: conn
     }}
  end

  def handle_call({:insert, id, data, strict}, _, state) do
    case insert_row(id, data, strict, state) do
      {:error, _} = error ->
        {:reply, error, state}

      {:ok, state} ->
        {:reply, :ok, state}
    end
  end

  def handle_call({:update, id, data, strict}, _, state) do
    case update_row(id, data, strict, state) do
      {:error, _} = error ->
        {:reply, error, state}

      {:ok, state} ->
        {:reply, :ok, state}
    end
  end

  def handle_call({:delete, id, strict}, _, state) do
    case delete_row(id, strict, state) do
      {:error, _} = error ->
        {:reply, error, state}

      {:ok, state} ->
        {:reply, :ok, state}
    end
  end

  def handle_call({:push_changes, commit_timestamp}, _, state) do
    {:ok, state} = push_transaction(commit_timestamp, state)
    {:reply, :ok, state}
  end

  def handle_info(msg, state) do
    Logger.info("#{inspect(msg)}")
    {:noreply, state}
  end

  defp insert_row(id, data, true, state) do
    case :ets.insert_new(state.user_table, {id, data}) do
      false ->
        {:error, :already_present}

      true ->
        true = insert_oplog(state.last_oplog_pos + 1, :insert, id, data, nil, state)
        true = :ets.insert_new(state.shadow_table, {id, []})
        {:ok, %State{state | last_oplog_pos: state.last_oplog_pos + 1}}
    end
  end

  defp insert_row(id, data, false, state) do
    update_row(id, data, false, state)
  end

  defp update_row(id, new_data, strict, state) do
    case :ets.lookup(state.user_table, id) do
      [] when strict == true ->
        {:error, :do_not_exist}

      [] when strict == false ->
        insert_row(id, new_data, true, state)

      [{_, old_data}] ->
        true = :ets.update_element(state.user_table, id, {2, new_data})
        false = :ets.insert_new(state.shadow_table, {id, []})
        true = insert_oplog(state.last_oplog_pos + 1, :update, id, new_data, old_data, state)
        {:ok, %State{state | last_oplog_pos: state.last_oplog_pos + 1}}
    end
  end

  defp delete_row(id, _strict = true, state) do
    case :ets.lookup(state.user_table, id) do
      [] ->
        {:error, :do_not_exist}

      [{^id, data}] ->
        :ets.insert_new(state.shadow_table, {id, []})
        true = insert_oplog(state.last_oplog_pos + 1, :delete, id, nil, data, state)
        {:ok, %State{state | last_oplog_pos: state.last_oplog_pos + 1}}
    end
  end

  @spec push_transaction(integer(), State.t()) :: {:ok, State.t()}
  defp push_transaction(commit_timestamp, %State{} = state) do
    changes =
      :ets.foldl(
        fn {pos, dml, id, new_row, old_row}, acc ->
          case pos > state.last_sent_pos do
            true ->
              [{dml, id, new_row, old_row} | acc]
              clear_tags = fetch_shadow(id, state)

              cond do
                dml == :delete ->
                  update_shadow(id, [], state)

                  [
                    %DeletedRecord{
                      relation: state.relation_id,
                      old_record: old_row,
                      tags: clear_tags
                    }
                    | acc
                  ]

                dml == :insert ->
                  update_shadow(id, [generateTag(commit_timestamp, state)], state)

                  [
                    %NewRecord{relation: state.relation_id, record: new_row, tags: clear_tags}
                    | acc
                  ]

                dml == :update ->
                  update_shadow(id, [generateTag(commit_timestamp, state)], state)

                  [
                    %UpdatedRecord{
                      relation: state.relation_id,
                      old_record: old_row,
                      record: new_row,
                      tags: clear_tags
                    }
                    | acc
                  ]
              end

            false ->
              acc
          end
        end,
        [],
        state.oplog_table
      )

    {:ok, datetime} = DateTime.from_unix(commit_timestamp, :millisecond)

    SatelliteWsClient.send_tx_internal(
      state.conn,
      %Transaction{
        changes: changes,
        commit_timestamp: datetime,
        origin: state.origin,
        lsn: state.last_oplog_pos
      },
      state.last_oplog_pos,
      state.relations_mapping
    )

    {:ok, %State{state | last_sent_pos: state.last_oplog_pos}}
  end

  defp insert_oplog(pos, dml, id, new_data, old_data, state) do
    :ets.insert_new(
      state.oplog_table,
      {pos, dml, id, new_data, old_data}
    )
  end

  defp fetch_shadow(id, state) do
    [{^id, shadow_value}] = :ets.lookup(state.shadow_table, id)
    shadow_value
  end

  defp update_shadow(id, value, state) do
    :ets.insert(state.shadow_table, {id, value})
  end

  defp generateTag(commit_timestamp, state) do
    state.origin <> "@" <> Integer.to_string(commit_timestamp)
  end
end
