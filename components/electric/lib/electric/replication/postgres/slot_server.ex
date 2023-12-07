defmodule Electric.Replication.Postgres.SlotServer do
  @moduledoc """
  A GenStage consumer that receives a list of client transactions and invokes a user-provided function on each of them.
  The intended user-provided function is `Electric.Replication.Postgres.TcpServer.tcp_send/2`.

  This stage keeps track of the latest LSN sent, and converts the incoming replication
  changes to the Postgres logical replication messages, with correctly incrementing LSNs.

  The `producer_name` option should specify the module for a GenStage producer that emits transactions to be sent to
  Postgres via the outgoing logical replication stream.
  """

  use GenStage

  require Logger
  alias Electric.Telemetry.Metrics
  alias Electric.Postgres.Lsn
  alias Electric.Postgres.LogicalReplication.Messages, as: ReplicationMessages
  alias Electric.Postgres.Messaging
  alias Electric.Postgres.Extension
  alias Electric.Replication.Connectors
  alias Electric.Replication.Changes
  alias Electric.Postgres.ShadowTableTransformation

  import Electric.Postgres.Extension,
    only: [is_acked_client_lsn_relation: 1, is_extension_relation: 1]

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
              telemetry_span: nil,
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
       producer_pid: nil,
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

    span =
      Metrics.start_span([:postgres, :replication_to], %{}, %{})

    :gproc.await(state.producer_name, 1_000)

    {position, state} = logical_publisher_position_from_lsn(state, start_lsn)
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
     %{
       state
       | publication: publication,
         send_fn: send_fn,
         timer: timer,
         socket_process_ref: ref,
         telemetry_span: span
     }}
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
  def handle_events(events, _from, %State{} = state)
      when replication_started?(state) do
    state =
      Enum.reduce(events, state, fn {tx, pos}, state ->
        case filter_extension_relations(tx) do
          %{changes: []} -> state
          tx -> send_transaction(tx, pos, state)
        end
      end)

    send(state.producer_pid, {:sent_all_up_to, state.current_source_position})

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

  @impl true
  def handle_subscribe(:producer, _opts, {pid, _tag}, %State{} = state) do
    {:automatic, %{state | producer_pid: pid}}
  end

  # Private function

  defp filter_extension_relations(%Changes.Transaction{changes: changes} = tx) do
    filtered_changes =
      Enum.reject(changes, fn %{relation: relation} ->
        is_extension_relation(relation) and not is_acked_client_lsn_relation(relation)
      end)

    %{tx | changes: filtered_changes}
  end

  defp send_transaction(tx, pos, state) do
    {wal_messages, relations, new_lsn} = convert_to_wal(tx, state)
    send_all(wal_messages, state.send_fn, state.telemetry_span)

    %State{
      state
      | current_lsn: new_lsn,
        sent_relations: relations,
        current_source_position: pos
    }
  end

  defp clear_replication(%State{} = state) do
    Process.demonitor(state.socket_process_ref)
    if state.timer, do: :timer.cancel(state.timer)
    Metrics.stop_span(state.telemetry_span)

    %State{
      state
      | publication: nil,
        send_fn: nil,
        timer: nil,
        socket_process_ref: nil,
        sent_relations: %{},
        telemetry_span: nil
    }
  end

  defp send_all(messages, send_fn, telemetry_span) when is_function(send_fn, 1) do
    {{last_lsn, _}, len} = Electric.Utils.list_last_and_length(messages)
    {first_lsn, _} = List.first(messages)

    Metrics.span_event(telemetry_span, :send, %{wal_messages: len, transactions: 1})

    Logger.debug(
      "Sending #{len} messages to the subscriber: from #{inspect(first_lsn)} to #{inspect(last_lsn)}"
    )

    messages
    |> Enum.map(fn {lsn, message} -> Messaging.replication_log(lsn, lsn, message) end)
    |> Enum.each(send_fn)
  end

  defp logical_publisher_position_from_lsn(state, start_lsn) do
    case Lsn.compare(state.current_lsn, start_lsn) do
      :lt ->
        # Electric was restarted. Use start_lsn as the initial value for current_lsn and start streaming from the
        # beginning of the outgoing logical replication stream.
        {-1, %{state | current_lsn: start_lsn}}

      _gt_or_eq ->
        {state.current_source_position, state}
    end
  end

  defp convert_to_wal(
         %Changes.Transaction{commit_timestamp: ts, changes: changes, origin: origin},
         %State{} = state
       ) do
    first_lsn = Lsn.increment(state.current_lsn)

    {internal_relations, user_relations} =
      changes
      |> Enum.map(& &1.relation)
      |> Enum.split_with(&is_extension_relation/1)

    internal_relations =
      internal_relations
      |> Stream.uniq()
      |> Stream.map(&Extension.SchemaCache.Global.internal_relation!/1)

    # always fetch the table info from the schema registry, don't rely on
    # our cache, which is just to determine which relations to send
    # this keeps the column lists up to date in the case of migrations
    user_relations =
      user_relations
      |> state.preprocess_relation_list_fn.()
      |> Stream.uniq()
      |> Stream.map(&Extension.SchemaCache.Global.relation!/1)

    combined_relations = Enum.concat(internal_relations, user_relations)

    # detect missing relations based on name *and* on column list
    missing_relations =
      Enum.reject(combined_relations, fn table_info ->
        Map.get(state.sent_relations, {table_info.schema, table_info.name}) == table_info
      end)

    relations = Enum.into(combined_relations, state.sent_relations, &{{&1.schema, &1.name}, &1})

    # Final LSN as specified by `BEGIN` message should be after all LSNs of actual changes but before the LSN of the commit
    {messages, final_lsn} =
      changes
      |> Enum.flat_map(&preprocess_changes(state, &1, relations, {ts, origin}))
      |> tap(
        &Logger.debug(fn ->
          "Processed tx changes (# pre: #{length(changes)}, # post: #{length(&1)}): " <>
            inspect(&1, pretty: true)
        end)
      )
      |> Enum.map(&changes_to_wal(&1, relations))
      |> Enum.map_reduce(first_lsn, fn elem, lsn -> {{lsn, elem}, Lsn.increment(lsn)} end)

    relation_messages =
      Enum.map(missing_relations, fn table_info ->
        {%Lsn{segment: 0, offset: 0}, relation_to_wal(table_info)}
      end)

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

  defp preprocess_changes(%State{} = state, change, _, _)
       when is_nil(state.preprocess_change_fn) or is_extension_relation(change.relation),
       do: [change]

  defp preprocess_changes(%State{preprocess_change_fn: fun} = state, change, relations, tag)
       when is_function(fun, 4),
       do: fun.(change, relations, tag, state.origin)

  defp changes_to_wal(%Changes.NewRecord{record: data, relation: table}, relations) do
    %ReplicationMessages.Insert{
      relation_id: relations[table].oid,
      tuple_data: record_to_tuple(data, relations[table].columns)
    }
  end

  defp changes_to_wal(%Changes.Compensation{relation: table, record: new}, relations) do
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

  defp relation_to_wal(table_info) do
    %ReplicationMessages.Relation{
      id: table_info.oid,
      name: table_info.name,
      namespace: table_info.schema,
      replica_identity: table_info.replica_identity,
      columns: Enum.map(table_info.columns, &column_to_wal/1)
    }
  end

  defp column_to_wal(column) do
    # If `nil`, Postgres also expects the `:key` flag to be set
    flags = if column.part_of_identity? != false, do: [:key], else: []

    %ReplicationMessages.Relation.Column{
      flags: flags,
      name: column.name,
      type_oid: Electric.Postgres.OidDatabase.oid_for_name(column.type),
      type_modifier: column.type_modifier
    }
  end

  # TODO: Should probably have backfilling of columns with defaults/nulls
  defp record_to_tuple(record, columns) do
    Enum.map(columns, &Map.fetch!(record, &1.name))
  end
end
