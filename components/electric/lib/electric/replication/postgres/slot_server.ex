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
  alias Electric.Telemetry.Metrics
  alias Electric.Postgres.Lsn
  alias Electric.Postgres.LogicalReplication.Messages, as: ReplicationMessages
  alias Electric.Postgres.Messaging
  alias Electric.Postgres.Extension.SchemaCache
  alias Electric.Replication.Connectors
  alias Electric.Replication.Changes
  alias Electric.Replication.OffsetStorage
  alias Electric.Postgres.ShadowTableTransformation

  import Electric.Postgres.Extension, only: [is_extension_relation: 1]

  defmodule State do
    defstruct current_lsn: %Lsn{segment: 0, offset: 1},
              config: nil,
              origin: nil,
              send_fn: nil,
              slot_name: nil,
              publication: nil,
              timer: nil,
              socket_process_ref: nil,
              producer_name: nil,
              producer_pid: nil,
              sent_relations: %{},
              current_source_position: nil,
              preprocess_relation_list_fn: nil,
              preprocess_change_fn: nil,
              opts: []
  end

  defguardp replication_started?(state) when not is_nil(state.send_fn)

  @type server :: pid() | String.t()
  @type send_fn :: (binary() -> none())

  @type slot_name :: String.t()
  @type slot_reg :: Electric.reg_name()

  @type column :: %{name: String.t()}
  @type relations_map :: %{
          optional(Changes.relation()) => %{
            primary_keys: [String.t(), ...],
            columns: [column()],
            oid: non_neg_integer()
          }
        }
  @type preprocess_change_fn ::
          (Changes.change(), relations_map(), {DateTime.t(), String.t()}, String.t() ->
             [Changes.change()])
  @type preprocess_relation_list_fn :: ([Changes.relation()] -> [Changes.relation()])

  @type opts ::
          {:conn_config, Connectors.config()}
          | {:producer, Electric.reg_name()}
          | {:preprocess_change_fn, preprocess_change_fn()}
          | {:preprocess_relation_list_fn, preprocess_relation_list_fn()}

  # Public interface

  @spec start_link([opts(), ...]) :: GenServer.on_start()
  def start_link(opts) do
    GenStage.start_link(__MODULE__, opts)
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

  defp subscription_opts() do
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
  def init(opts) do
    conn_config = Keyword.fetch!(opts, :conn_config)
    {:via, :gproc, producer} = Keyword.fetch!(opts, :producer)

    origin = Connectors.origin(conn_config)
    replication_opts = Connectors.get_replication_opts(conn_config)
    slot = replication_opts.subscription

    :gproc.reg(name(origin))
    :gproc.reg(name({:slot_name, slot}))

    Logger.metadata(origin: origin, pg_slot: slot)

    Logger.debug(
      "slot server started, registered as #{inspect(name(origin))} and #{inspect(name({:slot_name, slot}))}"
    )

    {:consumer,
     %State{
       config: conn_config,
       slot_name: slot,
       origin: origin,
       producer_name: producer,
       opts: Map.get(replication_opts, :opts, []),
       # Under the current implementation, this function is always going to be
       # `ShadowTableTransformation.split_change_into_main_and_shadow/4`,
       # but I'm using the "plain" behaviour of SlotServer for working with Postgres, so it's
       # "dependency-injected" here so that I can easily disable it
       preprocess_change_fn:
         Keyword.get(
           opts,
           :preprocess_change_fn,
           &ShadowTableTransformation.split_change_into_main_and_shadow/4
         ),
       # Comment for `preprocess_change_fn` also relevant here
       preprocess_relation_list_fn:
         Keyword.get(
           opts,
           :preprocess_relation_list_fn,
           &ShadowTableTransformation.add_shadow_relations/1
         )
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

  @impl true
  def handle_call({:start_replication, _, _, _}, _, state) when replication_started?(state) do
    Logger.warning("Replication already started #{state.slot_name}")
    {:reply, {:error, :replication_already_started}, [], state}
  end

  @impl true
  def handle_call(
        {:start_replication, send_fn, publication, start_lsn},
        {from, _},
        %State{} = state
      ) do
    ref = Process.monitor(from)

    timer =
      if Keyword.get(state.opts, :keepalive_enabled?, true),
        do: :timer.send_interval(10000, :send_keepalive)

    Logger.info("Starting replication to #{state.slot_name}")

    Metrics.pg_slot_replication_event(state.origin, %{start: 1})

    :gproc.await(state.producer_name, 1_000)

    # TODO: We're currently not using this position in a the `SatelliteCollectorProducer`, but we should
    position = get_pg_position(state.slot_name, start_lsn)
    Logger.debug("Got position #{inspect(position)} for start_lsn #{inspect(start_lsn)}")

    GenStage.async_subscribe(
      self(),
      [
        to: {:via, :gproc, state.producer_name},
        cancel: :temporary,
        starting_from: position
      ] ++ subscription_opts()
    )

    send(self(), :send_keepalive)

    {:reply, :ok, [],
     %{state | publication: publication, send_fn: send_fn, timer: timer, socket_process_ref: ref}}
  end

  @impl true
  def handle_call({:stop_replication}, _, state) do
    Metrics.pg_slot_replication_event(state.origin, %{stop: 1})

    {:reply, :ok, [], clear_replication(state)}
  end

  @impl true
  def handle_info({:DOWN, ref, :process, _, _}, state) when ref == state.socket_process_ref do
    # Socket process died unexpectedly, send function is likely invalid so we stop replication
    {:noreply, [], clear_replication(state)}
  end

  @impl true
  def handle_info(:send_keepalive, state) when replication_started?(state) do
    # Logger.debug("#{__MODULE__}: <KeepAlive>")

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

    GenStage.async_subscribe(
      self(),
      [
        to: pid,
        cancel: :temporary
      ] ++ subscription_opts()
    )

    {:noreply, [], %State{state | producer_pid: pid}}
  end

  @impl true
  def handle_events(events, _from, %State{origin: origin} = state)
      when replication_started?(state) do
    state =
      Enum.reduce(events, state, fn {transaction, position}, state ->
        transaction = filter_extension_relations(transaction)

        case transaction do
          %{changes: []} ->
            state

          transaction ->
            Logger.debug(fn ->
              "Will send #{length(transaction.changes)} to subscriber: #{inspect(transaction.changes, pretty: true)}"
            end)

            {wal_messages, relations, new_lsn} = convert_to_wal(transaction, state)

            send_all(wal_messages, state.send_fn, origin)

            %{
              state
              | current_lsn: new_lsn,
                sent_relations: relations,
                current_source_position: position
            }
        end
      end)

    OffsetStorage.save_pg_position(
      state.slot_name,
      state.current_lsn,
      state.current_source_position
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

  defp filter_extension_relations(%Changes.Transaction{changes: changes} = tx) do
    %{
      tx
      | changes:
          Enum.reject(changes, fn
            %{relation: relation} when is_extension_relation(relation) -> true
            _ -> false
          end)
    }
  end

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

  defp send_all(reversed_messages, send_fn, origin) when is_function(send_fn, 1) do
    {{first_lsn, _}, len} = Electric.Utils.list_last_and_length(reversed_messages)
    {last_lsn, _} = List.first(reversed_messages)

    Metrics.pg_slot_replication_event(origin, %{sent_total: len})

    Logger.debug(
      "Sending #{len} messages to the subscriber: from #{inspect(first_lsn)} to #{inspect(last_lsn)}"
    )

    reversed_messages
    |> Enum.map(fn {lsn, message} -> Messaging.replication_log(lsn, lsn, message) end)
    |> Enum.each(send_fn)
  end

  defp get_pg_position(slot_name, start_lsn) do
    case OffsetStorage.get_pg_position(slot_name, start_lsn) do
      nil ->
        case OffsetStorage.get_largest_known_lsn_smaller_than(slot_name, start_lsn) do
          {lsn, position} ->
            Logger.debug("Lsn #{inspect(start_lsn)} not found, falling back to #{inspect(lsn)}")
            position

          nil ->
            Logger.debug("Lsn #{inspect(start_lsn)} not found, falling back to 0")
            nil
        end

      position ->
        position
    end
  end

  defp convert_to_wal(
         %Changes.Transaction{commit_timestamp: ts, changes: changes, origin: origin},
         %State{} = state
       ) do
    first_lsn = Lsn.increment(state.current_lsn)

    # always fetch the table info from the schema registry, don't rely on
    # our cache, which is just to determine which relations to send
    # this keeps the column lists up to date in the case of migrations
    relations =
      changes
      |> Enum.map(& &1.relation)
      |> state.preprocess_relation_list_fn.()
      |> Enum.uniq()
      |> Enum.map(&SchemaCache.Global.relation!/1)

    # detect missing relations based on name *and* on column list
    missing_relations =
      relations
      |> Enum.reject(fn r ->
        Map.get(state.sent_relations, {r.schema, r.name}) == r
      end)

    relations = Enum.into(relations, state.sent_relations, &{{&1.schema, &1.name}, &1})

    # Final LSN as specified by `BEGIN` message should be after all LSNs of actual changes but before the LSN of the commit
    {messages, final_lsn} =
      changes
      |> Enum.flat_map(&preprocess_changes(state, &1, relations, {ts, origin}))
      |> tap(&Logger.debug("Messages after preprocessing: #{inspect(&1, pretty: true)}"))
      |> Enum.map(&changes_to_wal(&1, relations))
      |> Enum.map_reduce(first_lsn, fn elem, lsn -> {{lsn, elem}, Lsn.increment(lsn)} end)

    relation_messages =
      missing_relations
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

  defp preprocess_changes(%State{preprocess_change_fn: nil}, change, _, _), do: [change]

  defp preprocess_changes(%State{preprocess_change_fn: fun} = state, change, relations, tag)
       when is_function(fun, 4),
       do: fun.(change, relations, tag, state.origin)

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

  # TODO: Should probably have backfilling of columns with defaults/nulls
  defp record_to_tuple(record, columns) do
    Enum.map(columns, &Map.fetch!(record, &1.name))
  end
end
