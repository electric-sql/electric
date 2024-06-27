defmodule Electric.Satellite.ClientReconnectionInfo do
  @moduledoc """
  Store information related to each client that's needed for correct
  reconnection.

  ## Persistence

  Reconnection information is meant to be persistent on the same timescale as
  client reconnection is allowed. Currently, that's bounded by
  `Electric.Postgres.CachedWal` lifetime of Electric instance uptime.

  ## Stored information

  When the client reconnects, it sends two pieces of info: it's location
  in the replication stream (WAL position as a Cached WAL term) and a list
  of continued subscriptions. We need to restore sent rows graph to correctly
  process subsequent transactions.

  We store:
  1. List of subscriptions with xmin insertion points where they were sent
  2. Sent rows graph at the last ACK checkpoint
  3. Graph diffs for additional data restoration.

  Points 2 and 3 are expanded upon in the next sections

  ## Sent rows graph

  Just storing the latest graph is not enough, since the server process sees the graph
  from the point of sent rows, but when the client reconnects, it may ask to
  reconnect at a point in the past & we may need to reprocess some transactions.
  To address this, we're storing a graph at a point where the client had acknowledged
  a transaction, and if the client reconnects at some point after the checkpoint,
  we replay the transaction processing until we get to the same point.

  ## Additional data restoration and acknowledgement

  Once acknowledgement has been sent by the client we can be sure that the client wont
  try to reconnect before this ack point. We're using this to make a checkpoint, however
  it doesn't address all issues because the client can reconnect at any point after the
  ack. Since we're relying on the same "view of the world" between the server and the client,
  if there is anything sent to the client that's not recoverable from WAL itself, reconnection
  will lead to divergence.

  There are two kinds of operations that query additional data from PG to send to the client
  - initial data for a subscription or additional data for a transaction. This additional
  data has three "bad" properties: it's not already stored in WAL cache, it's shape- and
  user-specific, and it's irrecoverable without saving it. These properties mean that if a
  client has an ack point before transaction additional data, but reconnects saying that
  it had already seen additional data, we have a checkpointed sent rows graph that doesn't
  incorporate this additional data and we can query for it. This edge case leads to a
  requirement for storing this sent additional data - either in full or just as a graph diff.

  ### Example reconnection points and logic

  Consider the following operations (apart from ACK messages) that were sent in a session
  from the client (marked with `->`) and the server (unmarked).

  | N   | Op          | LSN | Graph State | Missing tx data |
  | --- | ----------- | --- | ----------- | --------------- |
  |     | -> SubReq 1 |     |             |                 |
  | 1   | SubResp 1   | 0   | 0           | {}              |
  | 2   | SubData 1   | 0   | 1 +         | {}              |
  | 3   | Tx1 +       | 1   | 2           | {1}             |
  | 4   | Tx2 +       | 2   | 3           | {1, 2}          |
  | 5   | Add Tx1     | 2   | 4 +         | {1}             |
  |     | -> SubReq 2 |     |             |                 |
  | 6   | SubResp2    | 2   | 4           | {1}             |
  | 7   | AddTx2      | 2   | 5 +         | {}              |
  | 8   | Tx3 +       | 3   | 6           | {3}             |
  | 9   | SubData 2   | 3   | 7 +         | {3}             |
  | 10  | AddTx3      | 3   | 8 +         | {}              |
  | 11  | Tx4         | 4   | 9           | {}              |

  In the table above, graph states marked with "+" had additional data added from a query,
  meaning we need to keep track of these additions until the client acknowledges them.
  If the client e.g. had sent an ack on N=4 but reconnects at N=8, then the only way
  to have the same state of the sent rows graph as the client at a point in time is
  to have stored graph state changes that incorporated additional data since the
  ack checkpoint.

  We can avoid storing entire additional data blob and go for a graph diff because
  if the client hasn't seen it yet we can just re-query postgres for that additional data.
  For example, if ack point is a N=3 and reconnection is at N=5, then we know that
  the client has never seen additional data for Tx2 - we can query it as if it's the first
  time the client is seeing this transaction.

  It's also important to store insertion points for initial subscription data: if the client
  with ack point at N=4 reconnects at N=11, when advancing checkpointed graph we need to
  correctly process Tx3 without consideration of shapes included in the second subscription.

  ### Performance tweaking

  Storing graph diff is not too bad in terms of memory, but it can get out of hand if, e.g. all
  transactions pull in large chunks of additional info. We have two mitigation mechanisms for
  this:

  1. We limit the "unacked window" - how many transactions we send to a client before we stop
     until the acknowledge what has already been received (this is stored in
     `Electric.Satellite.Protocol.OutRep`).
  2. We limit the amount of unacked additional data chunks - how many messages with subscription
     data and additional transaction data can go unacknowledged before we stop until some are.

  These tweaks allow to spend more memory for a smoother client experience on networks with
  big ping or bad upload speeds (or high-throughput setups where the server tries pushing a lot
  of transactions) - those that can't send acks quickly enough, but they also act as a
  safeguard against sending too much data to a misbehaving client. Ack messages are
  made to be as lightweight as possible while not hindering streaming speed from the server.

  ## Upon reconnection

  Client cannot reconnect before their last checkpoint - this guarantees garbage collection
  opportunity for the server. When the client reconnects with a list of subscriptions,
  we fetch the sent rows graph at the checkpoint. After that:
  1. If the client has sent less subscriptions than we established, then we clean the graph up
     as if the client unsubscribed
  2. The client sends a set of transaction IDs for which it had seen additional data.
     Any "wrong" ID in this case will be ignored. Only transactions whose data
     arrived immediately after the last acknowledged transaction matters - all
     others will be considered received because of insertion point ordering.
  3. The client sends continuation LSN
  4. Transactions are fetched from checkpoint to continuation LSN, and then applied to the
     sent rows graph. Any subscription established is applied at a point where the initial
     data was sent. Any seen additional data is cleared.
  5. If the client has seen the transaction, but not the additional data for it, then we
     redo the query for that transaction and act as if the client had just reached that txn.

  ## Implementation details

  Again, we're storing, uniquely identified by the client ID:
  1. A single checkpoint - LSN for an acknowledged transaction and a sent rows graph valid
     for this transaction.
  2. A list of fully established subscriptions with data insertion points (xmin)
  3. A set of additional data insertion points (both subscription and transaction) with
     a graph diff additional data produced. Insertion points need to have xmin and the
     insertion reason - transaction ID.
  4. A set of "actions" - structures describing a query to be executed in order to get
     additional data for a transaction - for transactions that have been acknowledged,
     but additional data for them hadn't.


  It's quite important to store only a graph diff and not a full new graph because
  ETS - what's likely to always act as a fast cache here - does full object copy on
  insert.

  Set of additional data points is read only when the client reconnects (and only up to
  reconnection point), is appended whenever the server sends or expects to send new data,
  and is cleared up to a new checkpoint when a new checkpoint is made.
  """

  use GenServer

  import Electric.Postgres.Extension,
    only: [
      client_checkpoints_table: 0,
      client_shape_subscriptions_table: 0,
      client_additional_data_table: 0,
      client_actions_table: 0,
      client_unsub_points_table: 0
    ]

  alias Electric.Postgres.CachedWal
  alias Electric.Postgres.Repo.Client
  alias Electric.Replication.Connectors
  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.Shapes.SentRowsGraph
  alias Electric.Replication.Shapes
  alias Electric.Replication.Shapes.ShapeRequest
  alias Electric.Utils

  require Logger

  @type client_id :: String.t()

  ## Tables used in this module

  @checkpoint_ets :reconnection_checkpoints
  @type checkpoint_row :: {client_id(), lsn :: CachedWal.Api.wal_pos(), Graph.t()}

  @subscriptions_ets :established_subscriptions
  @type subscriptions_row ::
          {
            {client_id(), sub_id :: String.t()},
            xmin :: non_neg_integer(),
            requests :: [ShapeRequest.t()],
            order :: non_neg_integer()
          }

  @actions_ets :actions_for_transaction
  @type actions_row :: {{client_id(), txid :: non_neg_integer()}, Shapes.subquery_actions()}

  @additional_data_ets :additional_data_points
  @type additional_data_sub_key ::
          {client_id(), xmin :: non_neg_integer(), order :: non_neg_integer(), :subscription,
           sub_id :: String.t()}
  @type additional_data_txn_key ::
          {client_id(), xmin :: non_neg_integer(), order :: non_neg_integer(), :transaction, nil}
  @type additional_data_sub_row :: {additional_data_sub_key(), graph_diff :: Graph.t(), []}
  @type additional_data_txn_row ::
          {additional_data_txn_key(), graph_diff :: Graph.t(),
           source_txns :: [non_neg_integer(), ...]}
  @type additional_data_row :: additional_data_sub_row() | additional_data_txn_row()

  @unsubscribe_points_ets :unsubscribe_points
  @type unsubscribe_points_row ::
          {{client_id(), sub_id :: String.t(), wal_pos :: non_neg_integer()}}

  def start_link(connector_config) do
    origin = Connectors.origin(connector_config)
    GenServer.start_link(__MODULE__, connector_config, name: name(origin))
  end

  def name(origin) do
    Electric.name(__MODULE__, origin)
  end

  @doc """
  Remove all stored data about client reconnection.

  Current implementation deletes a bunch of stuff from ETS without
  doing `:ets.safe_fixtable/2` because it carries an assumption
  that only one process will concurrently edit info for a particular
  client. This is ensured by `Electric.Satellite.ClientManager` allowing
  at most one WebSocket process with the same client id.
  """
  def clear_all_data!(origin, client_id) do
    clear_all_ets_data(client_id)

    Client.pooled_transaction(origin, fn ->
      Enum.each(
        [
          client_shape_subscriptions_table(),
          client_checkpoints_table(),
          client_actions_table(),
          client_additional_data_table(),
          client_unsub_points_table()
        ],
        &Client.query!("DELETE FROM #{&1} WHERE client_id = $1", [client_id])
      )
    end)

    :ok
  end

  @doc false
  def clear_all_ets_data(client_id) do
    :ets.match_delete(@actions_ets, {{client_id, :_}, :_})
    :ets.match_delete(@subscriptions_ets, {{client_id, :_}, :_, :_, :_})
    :ets.match_delete(@additional_data_ets, {{client_id, :_, :_, :_, :_}, :_, :_})
    :ets.match_delete(@unsubscribe_points_ets, {{client_id, :_, :_}})
    :ets.delete(@checkpoint_ets, client_id)
  end

  @doc """
  List all subscriptions that can be continued by a client.
  """
  def fetch_subscriptions(client_id, ids, lsn, unsub_ids) when is_list(ids) and ids != [] do
    subscription_ets_ms = Enum.map(ids, &{{{client_id, &1}, :_, :"$1", :_}, [], [{{&1, :"$1"}}]})
    results = :ets.select(@subscriptions_ets, subscription_ets_ms)

    seen_unsub_batches =
      MapSet.new(observed_unsub_points(client_id, lsn, unsub_ids), &elem(&1, 0))

    Enum.reject(results, fn {id, _} -> MapSet.member?(seen_unsub_batches, id) end)
  end

  defp delete_subscriptions(client_id, ids) when is_list(ids) and ids != [] do
    subscription_ets_ms = Enum.map(ids, &{{{client_id, &1}, :_, :_, :_}, [], [true]})
    :ets.select_delete(@subscriptions_ets, subscription_ets_ms)

    additional_data_ms =
      Enum.map(ids, &{{{client_id, :_, :_, :subscription, &1}, :_, :_}, [], [true]})

    :ets.select_delete(@additional_data_ets, additional_data_ms)

    unsubscribe_points_ms = Enum.map(ids, &{{{client_id, &1, :_}}, [], [true]})
    :ets.select_delete(@unsubscribe_points_ets, unsubscribe_points_ms)

    %{}
    |> merge_discarded({@subscriptions_ets, {client_id, {:sub_ids, ids}}})
    |> merge_discarded({@additional_data_ets, {client_id, {:sub_ids, ids}}})
    |> merge_discarded({@unsubscribe_points_ets, {client_id, {:sub_ids, ids}}})
  end

  @doc """
  Store initial checkpoint for the client after first connection and sent
  "shared" rows and/or migrations.
  """
  def store_initial_checkpoint!(origin, client_id, wal_pos, sent_rows_graph) do
    Client.pooled_transaction(origin, fn ->
      :ok = clear_all_data!(origin, client_id)
      :ok = store_client_checkpoint(client_id, wal_pos, sent_rows_graph)
    end)
  end

  @upsert_checkpoint_query """
  INSERT INTO
    #{client_checkpoints_table()}(client_id, pg_wal_pos, sent_rows_graph)
  VALUES
    ($1, $2, $3)
  ON CONFLICT
    (client_id)
  DO UPDATE SET
    pg_wal_pos = excluded.pg_wal_pos,
    sent_rows_graph = excluded.sent_rows_graph
  """

  defp store_client_checkpoint(client_id, wal_pos, sent_rows_graph) do
    sent_rows_graph_bin = :erlang.term_to_binary(sent_rows_graph)
    Client.query!(@upsert_checkpoint_query, [client_id, wal_pos, sent_rows_graph_bin])

    :ets.insert(@checkpoint_ets, {client_id, wal_pos, sent_rows_graph})

    :ok
  end

  @doc """
  Advance stored checkpoint graph up to next acknowledged LSN.

  Once the client acknowledges a transaction, we can advance the graph, deleting the previous
  version. We may have sent additional data to the client (both as subscription data and as
  additional data for transactions), and that was stored using `store_subscription_data!/4`
  and `store_additional_txn_data!/6`. This is useful in case the client reconnects having seen
  the data - we can correctly advance the graph using both transactions and additional data.

  To accommodate a case where the client reconnects **not** having seen data for some transaction,
  we store computed "actions" - a data structure that is used to query additional data from PG.
  Those get cleared as we advance the graph and reach additional data related to that transaction
  which "fulfils" this action. Any non-cleared actions present at reconnect after advancing
  the checkpoint can be immediately used to query data the client should have seen, but got
  disconnected.

  This function should not be used directly when the client reconnects, since it doesn't do
  garbage collection based on client's state at reconnection. `advance_on_reconnection/2` should
  be used instead.
  """
  @spec advance_checkpoint!(binary(), Keyword.t()) :: {:ok, Graph.t()} | {:error, term()}
  def advance_checkpoint!(client_id, opts) do
    case :ets.lookup(@checkpoint_ets, client_id) do
      [] ->
        {:error, :client_not_initialized}

      [{_, acked_wal_pos, graph}] ->
        new_wal_pos = Keyword.fetch!(opts, :ack_point)
        txids = Keyword.fetch!(opts, :including_data)
        subscription_ids = Keyword.fetch!(opts, :including_subscriptions)
        unsub_id_list = Keyword.fetch!(opts, :including_unsubscribes)
        cached_wal_impl = Keyword.get(opts, :cached_wal_impl, CachedWal.EtsBacked)
        origin = Keyword.fetch!(opts, :origin)
        advance_graph_fn = Keyword.fetch!(opts, :advance_graph_using)

        if CachedWal.Api.compare_positions(cached_wal_impl, acked_wal_pos, new_wal_pos) != :gt do
          received_data =
            MapSet.union(
              MapSet.new(txids, &{:transaction, &1}),
              MapSet.new(subscription_ids, &{:subscription, &1})
            )

          txn_stream =
            CachedWal.Api.stream_transactions(cached_wal_impl, origin,
              from: acked_wal_pos,
              to: new_wal_pos
            )

          {new_graph, pending_actions, count, discarded_acc} =
            advance_up_to_new_wal_pos(
              graph,
              advance_graph_fn,
              client_id,
              new_wal_pos,
              unsub_id_list,
              txn_stream
            )

          Logger.debug(
            "Advancing graph for #{inspect(client_id)} from #{inspect(acked_wal_pos)} to #{inspect(new_wal_pos)} by #{count} txns"
          )

          if map_size(pending_actions) > 0 do
            :ets.insert(@actions_ets, Enum.to_list(pending_actions))
          end

          {new_graph, discarded_acc} =
            advance_by_additional_data(new_graph, client_id, received_data, discarded_acc)

          Client.pooled_transaction(origin, fn ->
            delete_discarded_cache_entries(discarded_acc)
            store_client_checkpoint(client_id, new_wal_pos, new_graph)
            store_client_actions(pending_actions)

            if opts[:purge_additional_data] do
              purge_additional_data_for_client(client_id, subscription_ids)
            end
          end)

          {:ok, new_graph}
        else
          # Can't advance backwards
          {:error, {:wal_pos_before_checkpoint, acked_wal_pos, new_wal_pos}}
        end
    end
  rescue
    exception ->
      # Clear in-memory cache for the client to force its reloading from the database when the
      # client reconnects.
      clear_all_ets_data(client_id)
      reraise exception, __STACKTRACE__
  end

  @doc """
  Advance the graph up to the reconnection point, clearing all unsent data.

  Any sent transaction with additional data may "fall" into three states when
  the client reconnects: it wasn't observed, only the transaction itself
  was observed, or both the transaction and additional data was observed.

  If the transaction wasn't observed at all -- we discard the action that
  came from the transaction and additional data graph diff. The client
  will observe the transaction as a new one from WAL. If both were observed,
  then we discard the action and additional data graph diff while advancing
  the checkpoint as usual.

  When only the transaction was observed but not additional data, we don't
  have this additional data cached - only the graph diff - so we discard
  the diff and re-execute the action to refetch additional data. This essentially
  has the same effect as if PG is overloaded and just took a lot of time
  to process our readonly querying.
  """
  @spec advance_on_reconnection!(binary(), Keyword.t()) ::
          {:ok, Graph.t(), Shapes.action_context(), {[String.t()], [term()]} | nil}
          | {:error, term()}
  def advance_on_reconnection!(client_id, opts) do
    # We need to remove all additional data "in the future", but
    # execute actions that were seen but not fulfilled that way.
    # This is easy, since "actions" are stored at checkpoint advance time,
    # while additional data diffs are stored as soon as they were received, and
    # acknowledged additional data is removed while advancing. So we can just
    # indicate the all additional data must be removed in `advance_checkpoint!/2`
    # and return all the actions.
    opts = Keyword.put(opts, :purge_additional_data, true)

    with {:ok, new_graph} <- advance_checkpoint!(client_id, opts) do
      actions =
        @actions_ets
        |> :ets.match({{client_id, :"$1"}, :"$2"})
        |> Enum.reduce({%{}, []}, fn [txid, actions], acc ->
          Shapes.merge_actions_for_tx(acc, actions, txid)
        end)

      # If there are any not-continued unacknowledged unsubscriptions left, remove rows from the graph
      # and prepare a GONE batch.
      case :ets.select(@unsubscribe_points_ets, [{{{client_id, :"$1", :_}}, [], [:"$1"]}]) do
        [] ->
          {:ok, new_graph, actions, nil}

        unsent_unsub_ids ->
          request_ids = request_ids_for_subscriptions(client_id, unsent_unsub_ids)

          {gone_nodes, new_graph} = SentRowsGraph.pop_by_request_ids(new_graph, request_ids)

          {:ok, new_graph, actions, {unsent_unsub_ids, gone_nodes}}
      end
    end
  end

  @spec observed_unsub_points(client_id(), non_neg_integer(), [String.t()]) :: [
          {String.t(), non_neg_integer()}
        ]
  defp observed_unsub_points(client_id, wal_pos, observed_unsub_batches) do
    # Return all points before acked LSN, and all at acked LSN that have been explicitly observed.
    matches =
      [
        {{{client_id, :"$1", :"$2"}}, [{:<, :"$2", wal_pos}], [{{:"$1", :"$2"}}]}
        | Enum.map(observed_unsub_batches, &{{{client_id, &1, wal_pos}}, [], [{{&1, wal_pos}}]})
      ]

    :ets.select(@unsubscribe_points_ets, matches)
  end

  defp pop_valid_unsub_points(client_id, new_wal_pos, observed_unsub_batches) do
    points = observed_unsub_points(client_id, new_wal_pos, observed_unsub_batches)

    :ets.select_delete(
      @unsubscribe_points_ets,
      Enum.map(points, fn {id, wal_pos} -> {{{client_id, id, wal_pos}}, [], [true]} end)
    )

    Enum.map(points, &elem(&1, 0))
  end

  defp prune_active_subs(client_id, new_wal_pos, observed_unsub_batches) do
    relevant_unsubs = pop_valid_unsub_points(client_id, new_wal_pos, observed_unsub_batches)

    client_id
    |> list_subscriptions()
    |> Enum.split_with(fn {_, sub_id, _} -> sub_id in relevant_unsubs end)
    |> case do
      {[], subs} ->
        {subs, [], %{}}

      {unsubs, subs} ->
        removed_request_ids =
          Enum.flat_map(unsubs, fn {_, _, requests} -> Enum.map(requests, & &1.id) end)

        discarded = delete_subscriptions(client_id, Enum.map(unsubs, &elem(&1, 1)))

        {subs, removed_request_ids, discarded}
    end
  end

  # We're essentially advancing the graph until next fully acknowledged transaction +
  # subscription data
  defp advance_up_to_new_wal_pos(
         graph,
         advance_graph_fn,
         client_id,
         new_wal_pos,
         unsub_batches,
         txn_stream
       ) do
    {subs, removed_request_ids, discarded_acc} =
      prune_active_subs(client_id, new_wal_pos, unsub_batches)

    {_, graph} = SentRowsGraph.pop_by_request_ids(graph, removed_request_ids)

    state = {graph, %{}, 0, discarded_acc}

    Enum.reduce(txn_stream, state, fn %Transaction{} = txn,
                                      {graph, pending_actions, count, discarded_acc} ->
      {graph, pending_actions, discarded_acc} =
        client_id
        |> pop_additional_data_before(txn.xid)
        |> Enum.reduce({graph, pending_actions, discarded_acc}, fn
          {:transaction, diff, included_txns}, {graph, pending_actions, discarded_acc} ->
            {_, diff} = SentRowsGraph.pop_by_request_ids(diff, removed_request_ids)
            graph = merge_in_graph_diff(graph, diff)
            popped_actions = clear_stored_actions(client_id, included_txns)

            pending_actions =
              Map.drop(pending_actions, Enum.map(included_txns, &{client_id, &1}))

            {graph, pending_actions, merge_discarded(discarded_acc, popped_actions)}

          {:subscription, diff, []}, {graph, pending_actions, discarded_acc} ->
            # This cannot be a diff for an unsubbed subscription, because they were
            # deleted in `prune_active_subs/3`. Each sub diff carries only data for
            # subscription itself, so we don't need to pop rows when other subs are gone.
            graph = merge_in_graph_diff(graph, diff)
            {graph, pending_actions, discarded_acc}
        end)

      active_shapes = get_active_shapes_for_txid(subs, txn.xid)

      {fun, args} = advance_graph_fn

      {_, graph, actions} = apply(fun, [txn, graph, active_shapes | args])

      pending_actions =
        case actions do
          x when x == %{} -> pending_actions
          actions -> Map.put(pending_actions, {client_id, txn.xid}, actions)
        end

      discarded_acc =
        merge_discarded(discarded_acc, {@additional_data_ets, {client_id, {:lte_txid, txn.xid}}})

      {graph, pending_actions, count + 1, discarded_acc}
    end)
  end

  defp store_client_actions(actions_map) do
    num_actions = map_size(actions_map)

    if num_actions > 0 do
      values =
        Enum.flat_map(actions_map, fn {{client_id, txid}, actions} ->
          [client_id, txid, :erlang.term_to_binary(actions)]
        end)

      Client.query!(store_actions_query(num_actions), values)
    end

    :ok
  end

  defp store_actions_query(num_txns) do
    param_placeholders =
      Stream.iterate(1, &(&1 + 1))
      |> Stream.chunk_every(3)
      |> Stream.map(fn [n1, n2, n3] ->
        "($#{n1}, $#{n2}, $#{n3})"
      end)
      |> Stream.take(num_txns)
      |> Enum.join(", ")

    "INSERT INTO #{client_actions_table()}(client_id, txid, subquery_actions) VALUES " <>
      param_placeholders
  end

  defp get_active_shapes_for_txid(all_subs, txid) do
    all_subs
    |> Enum.take_while(fn {xmin, _, _} -> xmin < txid end)
    |> Enum.flat_map(&elem(&1, 2))
  end

  defp merge_in_graph_diff(graph, diff), do: Utils.merge_graph_edges(graph, diff)

  @spec advance_by_additional_data(Graph.t(), String.t(), MapSet.t(), map()) :: {Graph.t(), map()}
  defp advance_by_additional_data(graph, client_id, %MapSet{} = acknowledged, discarded_acc) do
    # This gives us next unused additional data piece for this client, and we're
    # looking to know if it's been acknowledged. Since `xmin`s (second value in the
    # key) are monotonically growing, we can ask for the next one and see if it's in
    # a set of acknowledged operations. Clients only need to directly confirm additional
    # data right after the last confirmed transaction. Anything else will be
    # automatically confirmed when the next transaction is acknowledged.
    case :ets.next(@additional_data_ets, {client_id, 0, 0, 0, 0}) do
      :"$end_of_table" ->
        # No additional data left for the client, great!
        {graph, discarded_acc}

      {_client_id, _xmin, _order, :subscription, id} = key ->
        if MapSet.member?(acknowledged, {:subscription, id}) do
          # Client has seen this subscription! Use it to advance the graph and delete it as
          # confirmed.
          diff = :ets.lookup_element(@additional_data_ets, key, 2)
          graph = merge_in_graph_diff(graph, diff)

          discarded_acc = merge_discarded(discarded_acc, delete_additional_data(key))

          # See if we can do one more
          advance_by_additional_data(graph, client_id, acknowledged, discarded_acc)
        else
          # Client hasn't seen this, so we're done here
          {graph, discarded_acc}
        end

      {_client_id, _xmin, _order, :transaction, nil} = key ->
        # We have this lookup here and additional one below to avoid copying in a graph if we don't need it.
        # Full key lookups are fast enough for this.
        covered_txns = :ets.lookup_element(@additional_data_ets, key, 3)

        # It's impossible for the client to see additional data for only one transaction out of a covered set,
        # since it's sent all in bulk without separation as to which transaction caused what exactly.
        if Enum.any?(covered_txns, &MapSet.member?(acknowledged, {:transaction, &1})) do
          # Client has seen this additional data blob!
          diff = :ets.lookup_element(@additional_data_ets, key, 2)
          graph = merge_in_graph_diff(graph, diff)

          discarded_acc =
            discarded_acc
            |> merge_discarded(delete_additional_data(key))
            |> merge_discarded(clear_stored_actions(client_id, covered_txns))

          # See if we can do one more
          advance_by_additional_data(graph, client_id, acknowledged, discarded_acc)
        else
          # Client hasn't seen this, so we're done here
          {graph, discarded_acc}
        end
    end
  end

  defp delete_additional_data({client_id, xmin, order, _subject, _subscription_id} = key) do
    :ets.delete(@additional_data_ets, key)

    {@additional_data_ets, {client_id, {:pk, xmin, order}}}
  end

  @delete_additional_data_for_client_query """
  DELETE FROM #{client_additional_data_table()} WHERE client_id = $1
  """

  @delete_unsubscribe_points_query """
  DELETE FROM #{client_unsub_points_table()} WHERE client_id = $1 AND subscription_id = ANY($2)
  """

  defp purge_additional_data_for_client(client_id, continued_subscriptions) do
    :ets.match_delete(@additional_data_ets, {{client_id, :_, :_, :_, :_}, :_, :_})
    Client.query!(@delete_additional_data_for_client_query, [client_id])

    # If the client continued any subscriptions without acknowledging the GONE batch,
    # remove the unsubscribe points for those.
    continued_subscriptions
    |> Enum.map(&{{{client_id, &1, :_}}, [], [true]})
    |> then(&:ets.select_delete(@unsubscribe_points_ets, &1))

    Client.query!(@delete_unsubscribe_points_query, [
      client_id,
      Enum.map(continued_subscriptions, &encode_uuid/1)
    ])
  end

  @insert_subscription_query """
  INSERT INTO
    #{client_shape_subscriptions_table()}(
      client_id,
      subscription_id,
      min_txid,
      ord,
      shape_requests
    )
  VALUES
    ($1, $2, $3, $4, $5)
  """

  @doc """
  Store a subscription with information as to where the data will fit in,
  and what were the requests issued as part of that subscription.
  """
  def store_subscription!(origin, client_id, subscription_id, xmin, pos, requests) do
    :ets.insert(@subscriptions_ets, {{client_id, subscription_id}, xmin, requests, pos})

    Client.pooled_query!(origin, @insert_subscription_query, [
      client_id,
      encode_uuid(subscription_id),
      xmin,
      pos,
      :erlang.term_to_binary(requests)
    ])

    :ok
  rescue
    exception ->
      # Clear in-memory cache for the client to force its reloading from the database when the
      # client reconnects.
      clear_all_ets_data(client_id)
      reraise exception, __STACKTRACE__
  end

  defp list_subscriptions(client_id) do
    :ets.select(@subscriptions_ets, [
      {{{client_id, :"$3"}, :"$1", :"$2", :_}, [], [{{:"$1", :"$3", :"$2"}}]}
    ])
  end

  defp request_ids_for_subscriptions(client_id, subscription_ids) do
    subscription_ids
    |> Enum.map(&{{{client_id, &1}, :_, :"$1", :_}, [], [:"$1"]})
    |> then(&:ets.select(@subscriptions_ets, &1))
    |> Enum.flat_map(fn x -> Enum.map(x, & &1.id) end)
  end

  @insert_subscription_data_query """
  INSERT INTO
    #{client_additional_data_table()}(
    client_id,
    min_txid,
    ord,
    subject,
    subscription_id,
    graph_diff,
    included_txns
  )
  VALUES
    ($1, $2, $3, 'subscription', $4, $5, '{}')
  """

  @doc """
  Store subscription graph diff once it had arrived.
  """
  def store_subscription_data!(origin, client_id, subscription_id, graph_diff) do
    xmin = :ets.lookup_element(@subscriptions_ets, {client_id, subscription_id}, 2)
    pos = :ets.lookup_element(@subscriptions_ets, {client_id, subscription_id}, 4)

    :ets.insert(
      @additional_data_ets,
      {{client_id, xmin, pos, :subscription, subscription_id}, graph_diff, []}
    )

    Client.pooled_query!(origin, @insert_subscription_data_query, [
      client_id,
      xmin,
      pos,
      encode_uuid(subscription_id),
      :erlang.term_to_binary(graph_diff)
    ])

    :ok
  rescue
    exception ->
      # Clear in-memory cache for the client to force its reloading from the database when the
      # client reconnects.
      clear_all_ets_data(client_id)
      reraise exception, __STACKTRACE__
  end

  @insert_transaction_data_query """
  INSERT INTO
    #{client_additional_data_table()}(
    client_id,
    min_txid,
    ord,
    subject,
    graph_diff,
    included_txns
  )
  VALUES
    ($1, $2, $3, 'transaction', $4, $5)
  """

  @doc """
  Store graph diff for additional data that was queried from PostgreSQL in
  response to a set of transactions.
  """
  def store_additional_txn_data!(origin, client_id, xmin, pos, included_txns, graph_diff) do
    :ets.insert(
      @additional_data_ets,
      {{client_id, xmin, pos, :transaction, nil}, graph_diff, included_txns}
    )

    Client.pooled_query!(origin, @insert_transaction_data_query, [
      client_id,
      xmin,
      pos,
      :erlang.term_to_binary(graph_diff),
      included_txns
    ])

    :ok
  rescue
    exception ->
      # Clear in-memory cache for the client to force its reloading from the database when the
      # client reconnects.
      clear_all_ets_data(client_id)
      reraise exception, __STACKTRACE__
  end

  @insert_unsub_points_query """
  INSERT INTO #{client_unsub_points_table()}
    (client_id, wal_pos, subscription_id)
  SELECT $1, $2, unnest($3::uuid[])
  """

  @doc """
  Store client-requested unsubscribe until the client acknowledges it.
  """
  def unsubscribe(origin, client_id, ids, wal_pos) when is_list(ids) and ids != [] do
    :ets.insert(@unsubscribe_points_ets, Enum.map(ids, &{{client_id, &1, wal_pos}}))

    Client.pooled_query!(origin, @insert_unsub_points_query, [
      client_id,
      wal_pos,
      Enum.map(ids, &encode_uuid/1)
    ])

    :ok
  rescue
    exception ->
      # Clear in-memory cache for the client to force its reloading from the database when the
      # client reconnects.
      clear_all_ets_data(client_id)
      reraise exception, __STACKTRACE__
  end

  @doc """
  Restore client reconnection info cache from the database.

  Must be called for a new WebsocketServer process before it starts streaming transactions to the client.
  """
  @spec restore_cache_for_client(Connectors.origin(), String.t()) :: :ok | {:error, Exception.t()}
  def restore_cache_for_client(origin, client_id) do
    if :ets.member(@checkpoint_ets, client_id) do
      # Client's info is already in the cache.
      :ok
    else
      GenServer.call(name(origin), {:restore_cache_for_client, client_id})
    end
  end

  defp pop_additional_data_before(client_id, txid) do
    pattern = {{client_id, :"$1", :_, :"$2", :_}, :"$3", :"$4"}
    guard = [{:"=<", :"$1", txid}]
    body = [{{:"$2", :"$3", :"$4"}}]

    results = :ets.select(@additional_data_ets, [{pattern, guard, body}])
    :ets.select_delete(@additional_data_ets, [{pattern, guard, [true]}])

    results
  end

  defp clear_stored_actions(client_id, txids) do
    matchspec = for txid <- txids, do: {{{client_id, txid}, :_}, [], [true]}
    :ets.select_delete(@actions_ets, matchspec)

    {@actions_ets, {client_id, txids}}
  end

  # Merge the discarded ETS entry given as the 2nd argument into the accumulator of discarded entries
  # given as the 1st argument.
  #
  # The accumulator aggregates deleted ETS entries from different tables and is eventually
  # passed to `delete_discarded_cache_entries/1` to build up and execute appropriate DELETE
  # statements that remove all discarded entries in one go.
  @spec merge_discarded(map, {:ets.table(), tuple}) :: map

  defp merge_discarded(acc, {@actions_ets, {client_id, new_txids}}) do
    Map.update(
      acc,
      @actions_ets,
      {client_id, new_txids},
      fn {^client_id, txids} -> {client_id, new_txids ++ txids} end
    )
  end

  defp merge_discarded(acc, {@additional_data_ets, {client_id, {:pk, xmin, order}}}) do
    Map.update(
      acc,
      @additional_data_ets,
      {client_id, [xmin], [order], nil, []},
      fn {^client_id, xmins, orders, txid, sub_ids} ->
        {client_id, [xmin | xmins], [order | orders], txid, sub_ids}
      end
    )
  end

  defp merge_discarded(acc, {@additional_data_ets, {client_id, {:lte_txid, new_txid}}}) do
    Map.update(
      acc,
      @additional_data_ets,
      {client_id, [], [], new_txid, []},
      fn {^client_id, xmins, orders, txid, sub_ids} ->
        {client_id, xmins, orders, max(new_txid, txid), sub_ids}
      end
    )
  end

  defp merge_discarded(acc, {@additional_data_ets, {client_id, {:sub_ids, new_sub_ids}}})
       when is_list(new_sub_ids) do
    Map.update(
      acc,
      @additional_data_ets,
      {client_id, [], [], nil, new_sub_ids},
      fn {^client_id, xmins, orders, txid, sub_ids} ->
        {client_id, xmins, orders, txid, sub_ids ++ new_sub_ids}
      end
    )
  end

  defp merge_discarded(acc, {@subscriptions_ets, {client_id, {:sub_ids, new_sub_ids}}})
       when is_list(new_sub_ids) do
    Map.update(
      acc,
      @subscriptions_ets,
      {client_id, new_sub_ids},
      fn {^client_id, sub_ids} -> {client_id, sub_ids ++ new_sub_ids} end
    )
  end

  defp merge_discarded(acc, {@unsubscribe_points_ets, {client_id, {:sub_ids, new_sub_ids}}})
       when is_list(new_sub_ids) do
    Map.update(
      acc,
      @unsubscribe_points_ets,
      {client_id, new_sub_ids},
      fn {^client_id, sub_ids} -> {client_id, sub_ids ++ new_sub_ids} end
    )
  end

  @delete_actions_for_xids_query """
  DELETE FROM
    #{client_actions_table()}
  WHERE
    client_id = $1 AND txid = ANY($2)
  """

  @delete_additional_data_query """
  DELETE FROM
    #{client_additional_data_table()}
  WHERE
    client_id = $1 AND (
      (min_txid, ord) = ANY(SELECT * FROM unnest($2::xid8[], $3::bigint[]))
      OR coalesce(min_txid <= $4, false)
      OR subscription_id = ANY($5::text[]::uuid[])
    )
  """

  @delete_subscriptions_query """
  DELETE FROM #{client_shape_subscriptions_table()}
  WHERE client_id = $1 AND subscription_id = ANY($2::text[]::uuid[])
  """

  @delete_unsubscribe_points_query """
  DELETE FROM #{client_unsub_points_table()}
  WHERE client_id = $1 AND subscription_id = ANY($2::text[]::uuid[])
  """

  # Given the accumulator of discarded ETS entries, issue one DELETE statement per table to
  # remove all discarded entries from the database.
  #
  # This function must be called in the context of a checked out Repo connection.
  defp delete_discarded_cache_entries(entries) do
    Enum.each(entries, fn
      {@actions_ets, {client_id, txids}} ->
        Client.query!(@delete_actions_for_xids_query, [client_id, txids])

      {@additional_data_ets, {client_id, xmins, orders, txid, sub_ids}} ->
        Client.query!(@delete_additional_data_query, [client_id, xmins, orders, txid, sub_ids])

      {@subscriptions_ets, {client_id, sub_ids}} ->
        Client.query!(@delete_subscriptions_query, [client_id, sub_ids])

      {@unsubscribe_points_ets, {client_id, sub_ids}} ->
        Client.query!(@delete_unsubscribe_points_query, [client_id, sub_ids])
    end)
  end

  @impl GenServer
  def init(connector_config) do
    origin = Connectors.origin(connector_config)
    Logger.metadata(component: "ClientReconnectionInfo")
    Process.set_label({:client_reconnection_info, origin})

    checkpoint_table = :ets.new(@checkpoint_ets, [:named_table, :public, :set])
    subscriptions_table = :ets.new(@subscriptions_ets, [:named_table, :public, :ordered_set])
    additional_data_table = :ets.new(@additional_data_ets, [:named_table, :public, :ordered_set])
    actions_table = :ets.new(@actions_ets, [:named_table, :public, :set])
    unsub_points_table = :ets.new(@unsubscribe_points_ets, [:named_table, :public, :ordered_set])

    state = %{
      origin: Connectors.origin(connector_config),
      checkpoint_table: checkpoint_table,
      subscriptions_table: subscriptions_table,
      additional_data_table: additional_data_table,
      actions_table: actions_table,
      unsub_points_table: unsub_points_table
    }

    {:ok, state, {:continue, :restore_cache}}
  end

  @impl GenServer
  def handle_continue(:restore_cache, state) do
    case await_connection_pool(state.origin) do
      :ready ->
        # Restore cached info for all clients at initialisation time.
        # Later on, when any one client's write fails to be persisted in the database, its
        # in-memory cached data will be cleared and later restored on-demand.
        :ok = restore_cached_info(nil, state)
        {:noreply, state}

      :timeout ->
        raise "Timed out waiting for the connection pool"
    end
  end

  @conn_pool_polling_timeout 10_000
  @conn_pool_polling_interval 500

  defp await_connection_pool(origin),
    do: await_connection_pool(origin, @conn_pool_polling_timeout, @conn_pool_polling_interval)

  defp await_connection_pool(_origin, time_remaining, _interval) when time_remaining <= 0,
    do: :timeout

  defp await_connection_pool(origin, time_remaining, interval) do
    if Electric.Replication.ConnectionPoolObserver.ready?(origin) do
      :ready
    else
      Process.sleep(interval)
      await_connection_pool(origin, time_remaining - interval, interval)
    end
  end

  @impl GenServer
  def handle_call({:restore_cache_for_client, client_id}, _from, state) do
    result = restore_cached_info([client_id], state)
    {:reply, result, state}
  end

  # This function is not expected to raise. It returns an error tuple of any of the DB queries
  # it executes fail.
  defp restore_cached_info(client_ids, state) do
    Client.checkout_from_pool(state.origin, fn ->
      with {:ok, checkpoints} <- load_checkpoints(client_ids),
           {:ok, subscriptions} <- load_subscriptions(client_ids),
           {:ok, additional_data} <- load_additional_data(client_ids),
           {:ok, actions} <- load_actions(client_ids),
           {:ok, unsub_points} <- load_unsub_points(client_ids) do
        :ets.insert(state.checkpoint_table, checkpoints)
        :ets.insert(state.subscriptions_table, subscriptions)
        :ets.insert(state.additional_data_table, additional_data)
        :ets.insert(state.actions_table, actions)
        :ets.insert(state.unsub_points_table, unsub_points)

        Logger.debug("Restored #{length(checkpoints)} cached client_checkpoints")
        Logger.debug("Restored #{length(subscriptions)} cached client_shape_subscriptions")
        Logger.debug("Restored #{length(additional_data)} cached client_additional_data records")
        Logger.debug("Restored #{length(actions)} cached client_actions")
        Logger.debug("Restored #{length(unsub_points)} cached client_unsub_points")

        :ok
      end
    end)
  end

  @load_checkpoints_query "SELECT * FROM #{client_checkpoints_table()}"
  defp load_checkpoints(client_ids) do
    with {:ok, {_cols, rows}} <- scoped_query(@load_checkpoints_query, client_ids) do
      tuples =
        Enum.map(rows, fn [client_id, wal_pos, sent_rows_graph] ->
          {client_id, wal_pos, :erlang.binary_to_term(sent_rows_graph)}
        end)

      {:ok, tuples}
    end
  end

  @load_subscriptions_query "SELECT * FROM #{client_shape_subscriptions_table()}"
  defp load_subscriptions(client_ids) do
    with {:ok, {_cols, rows}} <- scoped_query(@load_subscriptions_query, client_ids) do
      tuples =
        Enum.map(rows, fn [client_id, subs_id, xmin, pos, shape_requests_bin] ->
          {{client_id, decode_uuid(subs_id)}, xmin, :erlang.binary_to_term(shape_requests_bin),
           pos}
        end)

      {:ok, tuples}
    end
  end

  @load_additional_data_query "SELECT * FROM #{client_additional_data_table()}"
  defp load_additional_data(client_ids) do
    with {:ok, {_cols, rows}} <- scoped_query(@load_additional_data_query, client_ids) do
      tuples =
        Enum.map(rows, fn
          [client_id, xmin, pos, subject, subscription_id, graph_diff, included_txns] ->
            {{client_id, xmin, pos, String.to_existing_atom(subject),
              decode_uuid(subscription_id)}, :erlang.binary_to_term(graph_diff), included_txns}
        end)

      {:ok, tuples}
    end
  end

  @load_actions_query "SELECT * FROM #{client_actions_table()}"
  defp load_actions(client_ids) do
    with {:ok, {_cols, rows}} <- scoped_query(@load_actions_query, client_ids) do
      tuples =
        Enum.map(rows, fn [client_id, txid, actions_bin] ->
          {{client_id, txid}, :erlang.binary_to_term(actions_bin)}
        end)

      {:ok, tuples}
    end
  end

  @load_actions_query "SELECT * FROM #{client_unsub_points_table()}"
  defp load_unsub_points(client_ids) do
    with {:ok, {_cols, rows}} <- scoped_query(@load_actions_query, client_ids) do
      tuples =
        Enum.map(rows, fn [client_id, subs_id, wal_pos] ->
          {{client_id, decode_uuid(subs_id), wal_pos}}
        end)

      {:ok, tuples}
    end
  end

  # Perform a query that can be scoped by `client_ids`.
  defp scoped_query(query, nil) do
    Client.query(query, [])
  end

  defp scoped_query(base_query, client_ids) when is_list(client_ids) do
    Client.query(base_query <> " WHERE client_id = ANY($1)", [client_ids])
  end

  # The encode_uuid() and decode_uuid() functions are needed here due to incomplete adoption
  # of an Ecto repo for regular DB connections. Consider defining Ecto schemas for the database
  # tables referenced in this module to get automatic type conversion.

  defp encode_uuid(uuid_str) do
    {:ok, uuid_bin} = Ecto.UUID.dump(uuid_str)
    uuid_bin
  end

  defp decode_uuid(nil), do: nil

  defp decode_uuid(uuid_bin) do
    {:ok, uuid_str} = Ecto.UUID.load(uuid_bin)
    uuid_str
  end
end
