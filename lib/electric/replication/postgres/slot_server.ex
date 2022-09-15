defmodule Electric.Replication.Postgres.SlotServer do
  @moduledoc """
  Server to collect the upstream transaction and send them downstream to the subscriber

  This server keeps track of the latest LSN sent, and converts the incoming replication
  changes to the Postgres logical replication messages, with correctly incrementing LSNs.

  The `downstream` option should specify the module for a GenStage producer, which
  should implement the `Electric.Replication.DownstreamProducer` behaviour. Consumes
  the messages from the producer and sends the data to postgres.
  """

  use GenStage

  require Logger
  alias Electric.Postgres.Lsn
  alias Electric.Postgres.LogicalReplication.Messages, as: ReplicationMessages
  alias Electric.Postgres.Messaging
  alias Electric.Postgres.SchemaRegistry
  alias Electric.Replication.Changes
  alias Electric.Replication.OffsetStorage

  alias Electric.Replication.DownstreamProducer

  defmodule State do
    defstruct current_lsn: %Lsn{segment: 0, offset: 1},
              send_fn: nil,
              slot_name: nil,
              publication: nil,
              timer: nil,
              socket_process_ref: nil,
              producer: nil,
              producer_name: nil,
              producer_pid: nil,
              sent_relations: %{},
              current_vx_offset: nil,
              opts: []
  end

  defguardp replication_started?(state) when not is_nil(state.send_fn)

  @type server :: pid() | String.t()
  @type send_fn :: (binary() -> none())

  @type slot_name :: String.t()
  @type slot_reg :: Electric.reg_name()

  # Public interface

  @spec start_link(
          String.t(),
          %{
            replication: %{subscription: binary()},
            downstream: %{producer: module()}
          },
          Electric.reg_name()
        ) :: GenServer.on_start()
  def start_link(reg_name, init_args, producer) do
    GenStage.start_link(__MODULE__, [reg_name, init_args, producer])
  end

  @spec get_name(String.t()) :: Electric.reg_name()
  def get_name(name) do
    {:via, :gproc, name(name)}
  end

  @spec get_slot_reg(slot_name()) :: Electric.reg_name()
  def get_slot_reg(slot_name) do
    {:via, :gproc, name({:slot_name, slot_name})}
  end

  defp name(name) do
    {:n, :l, {__MODULE__, name}}
  end

  defp producer_info() do
    [min_demand: 10, max_demand: 50]
  end

  #  @spec connected?(slot_name()) :: boolean()
  def connected?(server) do
    GenStage.call(server, :connected?)
  end

  def downstream_connected?(server) do
    GenStage.call(server, :downstream_connected?)
  end

  @spec stop(server) :: :ok
  def stop(server) do
    GenStage.stop(server)
  end

  @spec get_current_lsn(Electric.reg_name()) :: Lsn.t() | {:error, term()}
  def get_current_lsn(server) do
    GenStage.call(server, :get_current_lsn)
  end

  @spec start_replication(Electric.reg_name(), send_fn(), String.t(), Lsn.t()) ::
          :ok | {:error, term()}
  def start_replication(server, send_fn, publication, lsn),
    do: GenStage.call(server, {:start_replication, send_fn, publication, lsn})

  @spec stop_replication(Electric.reg_name()) :: :ok
  def stop_replication(server) do
    GenStage.call(server, {:stop_replication})
  end

  @spec send_keepalive(Electric.reg_name() | pid()) :: :ok
  def send_keepalive(pid) when is_pid(pid) do
    send(pid, :send_keepalive)
  end

  def send_keepalive(server) do
    send_keepalive(GenServer.whereis(server))
  end

  # Server callbacks

  @impl true
  def init([origin, args, {:via, :gproc, producer}]) do
    slot = args.replication.subscription

    :gproc.nb_wait(producer)
    :gproc.reg(name(origin))
    :gproc.reg(name({:slot_name, slot}))

    Logger.metadata(origin: origin, pg_slot: slot)
    Logger.debug("slot server started")

    {:consumer,
     %State{
       slot_name: slot,
       producer_name: producer,
       producer: args.downstream.producer,
       opts: Map.get(args.replication, :opts, [])
     }}
  end

  @impl true
  def handle_call(:get_current_lsn, _, state) do
    {:reply, state.current_lsn, [], state}
  end

  @impl true
  def handle_call(:connected?, _, state) when replication_started?(state) do
    {:reply, true, [], state}
  end

  @impl true
  def handle_call(:connected?, _, state) do
    {:reply, false, [], state}
  end

  def handle_call(:downstream_connected?, _from, state) do
    res = DownstreamProducer.connected?(state.producer, state.producer_pid)
    Logger.debug("Requested downstream connection #{res}")
    {:reply, res, [], state}
  end

  @impl true
  def handle_call({:start_replication, _, _, _}, _, state) when replication_started?(state) do
    Logger.warning("Replication already started #{state.slot_name}")
    {:reply, {:error, :replication_already_started}, [], state}
  end

  @impl true
  def handle_call({:start_replication, send_fn, publication, start_lsn}, {from, _}, state) do
    ref = Process.monitor(from)

    timer =
      if Keyword.get(state.opts, :keepalive_enabled?, true),
        do: :timer.send_interval(10000, :send_keepalive)

    Logger.info("Starting replication to #{state.slot_name}")

    # FIXME: handle_continue should be supported on gen_stage
    send(self(), {:start_from_lsn, start_lsn})

    {:reply, :ok, [],
     %{state | publication: publication, send_fn: send_fn, timer: timer, socket_process_ref: ref}}
  end

  @impl true
  def handle_call({:stop_replication}, _, state) do
    {:reply, :ok, [], clear_replication(state)}
  end

  @impl true
  def handle_info({:DOWN, ref, :process, _, _}, state) when ref == state.socket_process_ref do
    # Socket process died unexpectedly, send function is likely invalid so we stop replication
    {:noreply, [], clear_replication(state)}
  end

  @impl true
  def handle_info({:start_from_lsn, start_lsn}, state) do
    send(self(), :send_keepalive)

    vx_offset = get_vx_offset(state.slot_name, start_lsn)

    Logger.debug("Got vx offset #{inspect(vx_offset)} for start_lsn #{inspect(start_lsn)}")

    DownstreamProducer.start_replication(
      state.producer,
      state.producer_pid,
      vx_offset
    )

    {:noreply, [], %{state | current_lsn: start_lsn}}
  end

  @impl true
  def handle_info(:send_keepalive, state) when replication_started?(state) do
    state.current_lsn
    |> Messaging.replication_keepalive()
    |> state.send_fn.()

    {:noreply, [], state}
  end

  def handle_info(:send_keepalive, state) do
    {:noreply, [], state}
  end

  def handle_info({:gproc, _, :registered, {_stage, pid, _}}, state) do
    Logger.debug("request subscription")

    :ok =
      GenStage.async_subscribe(self(), [
        {:to, pid},
        {:cancel, :temporary}
        | producer_info()
      ])

    {:noreply, [], %State{state | producer_pid: pid}}
  end

  @impl true
  def handle_events(events, _from, state) when replication_started?(state) do
    state =
      Enum.reduce(events, state, fn {transaction, vx_offset}, state ->
        Logger.debug(
          "Will send #{length(transaction.changes)} to subscriber: #{inspect(transaction.changes, pretty: true)}"
        )

        {wal_messages, relations, new_lsn} = convert_to_wal(transaction, state)
        send_all(Enum.reverse(wal_messages), state.send_fn)
        %{state | current_lsn: new_lsn, sent_relations: relations, current_vx_offset: vx_offset}
      end)

    OffsetStorage.put_pg_relation(
      state.slot_name,
      state.current_lsn,
      state.current_vx_offset
    )

    {:noreply, [], state}
  end

  @impl true
  def handle_events(_events, _from, state) do
    {:noreply, [], state}
  end

  @impl true
  def handle_cancel({:down, _}, _from, state) do
    Logger.debug("wait for producer")
    :gproc.nb_wait(state.producer_name)
    {:noreply, [], state}
  end

  # Private function

  defp clear_replication(%State{} = state) do
    Process.demonitor(state.socket_process_ref)
    if state.timer, do: :timer.cancel(state.timer)

    %State{
      state
      | publication: nil,
        send_fn: nil,
        timer: nil,
        socket_process_ref: nil,
        sent_relations: %{}
    }
  end

  defp send_all(messages, send_fn) when is_function(send_fn, 1) do
    reversed_messages = Enum.reverse(messages)
    {first_lsn, _} = List.first(messages)
    {last_lsn, _} = List.first(reversed_messages)

    Logger.debug(
      "Sending #{length(messages)} messages to the subscriber: from #{inspect(first_lsn)} to #{inspect(last_lsn)}"
    )

    reversed_messages
    |> Enum.map(fn {lsn, message} -> Messaging.replication_log(lsn, lsn, message) end)
    |> Enum.each(send_fn)
  end

  defp get_vx_offset(slot_name, start_lsn) do
    case OffsetStorage.get_vx_offset(slot_name, start_lsn) do
      nil ->
        case OffsetStorage.get_largest_known_lsn_smaller_than(slot_name, start_lsn) do
          {lsn, vx_offset} ->
            Logger.debug("Lsn #{inspect(start_lsn)} not found, falling back to #{inspect(lsn)}")
            vx_offset

          nil ->
            Logger.debug("Lsn #{inspect(start_lsn)} not found, falling back to 0")
            nil
        end

      vx_offset ->
        vx_offset
    end
  end

  defp convert_to_wal(%Changes.Transaction{commit_timestamp: ts, changes: changes}, state) do
    first_lsn = Lsn.increment(state.current_lsn)

    missing_relations =
      changes
      |> Enum.map(& &1.relation)
      |> Enum.uniq()
      |> Enum.reject(&is_map_key(state.sent_relations, &1))

    relations =
      missing_relations
      |> Enum.map(&SchemaRegistry.fetch_table_info!/1)
      |> Enum.map(&Map.put(&1, :columns, SchemaRegistry.fetch_table_columns!(&1.oid)))
      |> Enum.into(state.sent_relations, &{{&1.schema, &1.name}, &1})

    # Final LSN as specified by `BEGIN` message should be after all LSNs of actual changes but before the LSN of the commit
    {messages, final_lsn} =
      changes
      |> Enum.map(&changes_to_wal(&1, relations))
      |> Enum.map_reduce(first_lsn, fn elem, lsn -> {{lsn, elem}, Lsn.increment(lsn)} end)

    relation_messages =
      missing_relations
      |> Enum.map(&Map.fetch!(relations, &1))
      |> Enum.map(&relation_to_wal/1)
      |> Enum.map(&{%Lsn{segment: 0, offset: 0}, &1})

    commit_lsn = Lsn.increment(final_lsn)

    begin = [
      {first_lsn,
       %ReplicationMessages.Begin{
         commit_timestamp: ts,
         xid: 0,
         final_lsn: final_lsn
       }}
    ]

    commit = [
      {commit_lsn,
       %ReplicationMessages.Commit{
         commit_timestamp: ts,
         end_lsn: commit_lsn,
         flags: [],
         lsn: final_lsn
       }}
    ]

    {begin ++ relation_messages ++ messages ++ commit, relations, commit_lsn}
  end

  defp changes_to_wal(%Changes.NewRecord{record: data, relation: table}, relations) do
    %ReplicationMessages.Insert{
      relation_id: relations[table].oid,
      tuple_data: record_to_tuple(data, relations[table].columns)
    }
  end

  defp changes_to_wal(
         %Changes.UpdatedRecord{relation: table, old_record: nil, record: new},
         relations
       ) do
    %ReplicationMessages.Update{
      relation_id: relations[table].oid,
      tuple_data: record_to_tuple(new, relations[table].columns)
    }
  end

  defp changes_to_wal(
         %Changes.UpdatedRecord{relation: table, old_record: old, record: new},
         relations
       ) do
    %ReplicationMessages.Update{
      relation_id: relations[table].oid,
      old_tuple_data: record_to_tuple(old, relations[table].columns),
      tuple_data: record_to_tuple(new, relations[table].columns)
    }
  end

  defp changes_to_wal(%Changes.DeletedRecord{relation: table, old_record: old}, relations) do
    %ReplicationMessages.Delete{
      relation_id: relations[table].oid,
      old_tuple_data: record_to_tuple(old, relations[table].columns)
    }
  end

  defp changes_to_wal(%Changes.TruncatedRelation{relation: table}, relations) do
    %ReplicationMessages.Truncate{
      truncated_relations: [relations[table].oid],
      number_of_relations: 1,
      options: []
    }
  end

  defp relation_to_wal(relation) do
    %ReplicationMessages.Relation{
      id: relation.oid,
      name: relation.name,
      namespace: relation.schema,
      replica_identity: relation.replica_identity,
      columns: Enum.map(relation.columns, &column_to_wal/1)
    }
  end

  defp column_to_wal(column) do
    # If `nil`, Postgres also expects the `:key` flag to be set
    flags = if column.part_of_identity? != false, do: [:key], else: []

    %ReplicationMessages.Relation.Column{
      flags: flags,
      name: column.name,
      type: column.type,
      type_modifier: column.type_modifier
    }
  end

  defp record_to_tuple(record, columns) do
    columns
    |> Enum.map(&Map.fetch!(record, &1.name))
    |> List.to_tuple()
  end
end
