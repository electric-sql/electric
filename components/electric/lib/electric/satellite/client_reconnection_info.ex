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
  1. If the client has sent less subscriptions when we established, then we clean the graph up
     as if the client unsubscribed
  2. The client sends a set of transaction IDs for which it hadn't seen additional data.
     Any "wrong" ID in this case will be ignored.
  3. The client sends continuation LSN
  4. Transactions are fetched from checkpoint to continuation LSN, and then applied to the
     sent rows graph. If any subscription

  ## Implementation details

  Again, we're storing, uniquely identified by the client ID:
  1. A single checkpoint - LSN, txid, and a set of still-missing additional data points
     that the client has acknowledged>, LSN, txid of a last "fully acknowledged" transaction,
     and a sent rows graph valid for this transaction. We consider a transaction fully
     acknowledged when both the transaction and additional data has been received. This
     is important to correctly either replay additional data changes or re-query additional
     data.
  2. A list of fully established subscriptions with data insertion points (xmin)
  3. A set of additional data insertion points (both subscription and transaction) with
     a graph diff additional data produced. Insertion points need to have xmin and the
     insertion reason - transaction ID.

  It's quite important to store only a graph diff and not a full new graph because
  ETS - what's likely to always act as a fast cache here - does full object copy on
  insert.

  Set of additional data points is read only when the client reconnects (and only up to
  reconnection point), is appended whenever the server sends or expects to send new data,
  and is cleared up to a new checkpoint when a new checkpoint is made.
  """

  alias Electric.Replication.Shapes
  alias Electric.Replication.Shapes.ShapeRequest
  alias Electric.Utils
  alias Electric.Replication.Changes.Transaction
  alias Electric.Postgres.CachedWal

  require Logger
  use GenServer

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
          {client_id(), xmin :: non_neg_integer(), order :: non_neg_integer(), :transaction,
           ref :: non_neg_integer()}
  @type additional_data_sub_row :: {additional_data_sub_key(), graph_diff :: Graph.t(), []}
  @type additional_data_txn_row ::
          {additional_data_txn_key(), graph_diff :: Graph.t(),
           source_txns :: [non_neg_integer(), ...]}
  @type additional_data_row :: additional_data_sub_row() | additional_data_txn_row()

  def start_link(_) do
    GenServer.start_link(__MODULE__, [], name: __MODULE__)
  end

  def clear_all_data(client_id) do
    :ets.match_delete(@actions_ets, {{client_id, :_}, :_})
    :ets.match_delete(@subscriptions_ets, {{client_id, :_}, :_, :_, :_})
    :ets.match_delete(@additional_data_ets, {{client_id, :_, :_, :_, :_}, :_})
    :ets.delete(@checkpoint_ets, client_id)
  end

  def fetch_subscription(client_id, subscription_id) do
    case :ets.lookup(@subscriptions_ets, {client_id, subscription_id}) do
      [] -> :error
      [{_key, _xmin, data, _pos}] -> {:ok, data}
    end
  end

  def delete_subscription(client_id, subscription_id) do
    :ets.delete(@subscriptions_ets, {client_id, subscription_id})

    :ets.match_delete(
      @additional_data_ets,
      {{client_id, :_, :_, :subscription, subscription_id}, :_}
    )
  end

  @doc """
  Store initial checkpoint for the client after first connection and sent
  "shared" rows and/or migrations.
  """
  def store_initial_checkpoint(client_id, lsn, sent_rows_graph) do
    clear_all_data(client_id)

    :ets.insert(@checkpoint_ets, {client_id, lsn, sent_rows_graph})
  end

  @doc """
  Advance stored checkpoint graph up to next acknowledged LSN.

  Once the client acknowledges a transaction, we can advance the graph, deleting the previous
  version. We may have sent additional data to the client (both as subscription data and as
  additional data for transactions), and that was stored using `store_subscription_data/3`
  and `store_additional_tx_data/6`. This is useful in case the client reconnects having seen
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
  @spec advance_checkpoint(binary(), Keyword.t()) :: {:ok, Graph.t()} | {:error, term()}
  def advance_checkpoint(client_id, opts) do
    case :ets.lookup(@checkpoint_ets, client_id) do
      [] ->
        {:error, :client_not_initialized}

      [{_, acked_lsn, graph}] ->
        new_lsn = Keyword.fetch!(opts, :ack_point)
        txn_id_list = Keyword.fetch!(opts, :including_data)
        subscription_id_list = Keyword.fetch!(opts, :including_subscriptions)
        cached_wal_impl = Keyword.get(opts, :cached_wal_impl, CachedWal.EtsBacked)
        advance_graph_fn = Keyword.fetch!(opts, :advance_graph_using)

        if CachedWal.Api.compare_positions(cached_wal_impl, acked_lsn, new_lsn) != :gt do
          received_data =
            MapSet.new(txn_id_list, &{:transaction, &1})
            |> MapSet.union(MapSet.new(subscription_id_list, &{:subscription, &1}))

          new_graph =
            graph
            |> advance_up_to_new_lsn(
              client_id,
              cached_wal_impl,
              advance_graph_fn,
              acked_lsn,
              new_lsn
            )
            |> advance_by_additional_data(client_id, received_data)

          :ets.insert(@checkpoint_ets, {client_id, new_lsn, new_graph})

          {:ok, new_graph}
        else
          # Can't advance backwards
          {:error, {:lsn_before_checkpoint, acked_lsn, new_lsn}}
        end
    end
  end

  @doc """
  Advance the graph up to the reconnection point, clearing all unsent data.

  Any sent transaction with additional data may "fall" into three states when
  the client reconnects: it wasn't observed, only the transaction itself
  was observed, or both the transaction and additional data was observed.

  If the transaction wasn't observed at all -- we discard the action that
  came from the transaction and additional data graph diff. The client
  will observe the transaction as a new one from WAL. If the both were observed,
  then we discard the action and additional data graph diff while advancing
  the checkpoint as usual.

  When only the transaction was observed but not additional data, we don't
  have this additional data cached - only the graph diff - so we discard
  the diff and re-execute the action to refetch additional data. This essentially
  has the same effect as if PG is overloaded and just took a lot of time
  to process our readonly querying.
  """
  @spec advance_on_reconnection(any(), any()) ::
          {:ok, Graph.t(), Shapes.action_context()} | {:error, term()}
  def advance_on_reconnection(client_id, opts) do
    with {:ok, new_graph} <- advance_checkpoint(client_id, opts) do
      # Now we need to remove all additional data "in the future", but
      # execute actions that were seen but not fulfilled that way.
      # This is easy, since "actions" are stored at checkpoint advance time,
      # while additional data diffs are stored as soon as they were received, and
      # acknowledged additional data is removed while advancing. So we can just
      # delete all additional data here and return all the actions.
      :ets.match_delete(@additional_data_ets, {{client_id, :_, :_, :_, :_}, :_})

      actions =
        @actions_ets
        |> :ets.match({{client_id, :"$1"}, :"$2"})
        |> Enum.reduce({%{}, []}, fn [xid, actions], acc ->
          Shapes.merge_actions_for_tx(acc, actions, xid)
        end)

      {:ok, new_graph, actions}
    end
  end

  # We're essentially advancing the graph until next fully acknowledged transaction + subscription data
  defp advance_up_to_new_lsn(
         graph,
         client_id,
         cached_wal_impl,
         advance_graph_fn,
         full_acked_lsn,
         new_lsn
       ) do
    state = {graph, %{}, 0}

    subs = list_subscriptions(client_id)

    {graph, pending_actions, count} =
      cached_wal_impl
      |> CachedWal.Api.stream_transactions(from: full_acked_lsn, to: new_lsn)
      |> Enum.reduce(state, fn %Transaction{} = txn, {graph, pending_actions, count} ->
        {graph, pending_actions} =
          client_id
          |> pop_additional_data_before(txn.xid)
          |> Enum.reduce({graph, pending_actions}, fn
            {:transaction, _, diff, included_txns}, {graph, pending_actions} ->
              graph = merge_in_graph_diff(graph, diff)
              clear_stored_actions(client_id, included_txns)

              pending_actions =
                Map.drop(pending_actions, Enum.map(included_txns, &{client_id, &1}))

              {graph, pending_actions}

            {:subscription, _id, diff, _}, {graph, pending_actions} ->
              graph = merge_in_graph_diff(graph, diff)
              {graph, pending_actions}
          end)

        active_shapes = get_active_shapes_for_txid(subs, txn.xid)

        {fun, args} = advance_graph_fn

        {_, graph, actions} = apply(fun, [txn, graph, active_shapes | args])

        pending_actions =
          case actions do
            x when x == %{} -> pending_actions
            actions -> Map.put(pending_actions, {client_id, txn.xid}, actions)
          end

        {graph, pending_actions, count + 1}
      end)

    Logger.debug(
      "Advancing graph for #{inspect(client_id)} from #{inspect(full_acked_lsn)} to #{inspect(new_lsn)} by #{count} txns"
    )

    :ets.insert(@actions_ets, Enum.to_list(pending_actions))

    graph
  end

  defp get_active_shapes_for_txid(all_subs, txid) do
    all_subs
    |> Enum.take_while(fn {xmin, _} -> xmin < txid end)
    |> Enum.flat_map(&elem(&1, 1))
  end

  defp merge_in_graph_diff(graph, diff), do: Utils.merge_graph_edges(graph, diff)

  @spec advance_by_additional_data(Graph.t(), String.t(), MapSet.t()) :: Graph.t()
  defp advance_by_additional_data(
         graph,
         client_id,
         %MapSet{} = acknowledged
       ) do
    # This gives us next unused additional data piece for this client, and we're
    # looking to know if it's been acknowledged. Since `xmin`s (second value in the
    # key) are monotonically growing, we can ask for the next one and see if it's in
    # a set of acknowledged operations. Clients only need to directly confirm additional
    # data right after the last confirmed transaction. Anything else will be
    # automatically confirmed when the next transaction is acknowledged.
    case :ets.next(@additional_data_ets, {client_id, 0, 0, 0, 0}) do
      :"$end_of_table" ->
        # No additional data left for the client, great!
        graph

      {_client_id, _xmin, _order, kind, id} = key ->
        if MapSet.member?(acknowledged, {kind, id}) do
          # Client has seen this! Use it to advance the graph and delete it as confirmed.
          diff = :ets.lookup_element(@additional_data_ets, key, 2)
          graph = merge_in_graph_diff(graph, diff)
          :ets.delete(@additional_data_ets, key)
          # See if we can do one more
          advance_by_additional_data(graph, client_id, acknowledged)
        else
          # Client hasn't seen this, so we're done here
          graph
        end
    end
  end

  @doc """
  Store a subscription with information as to where the data will fit in,
  and what were the requests issued as part of that subscription.
  """
  def store_subscription(client_id, subscription_id, xmin, pos, requests) do
    :ets.insert(@subscriptions_ets, {{client_id, subscription_id}, xmin, requests, pos})
  end

  defp list_subscriptions(client_id) do
    :ets.select(@subscriptions_ets, [
      {{{client_id, :_}, :"$1", :"$2", :_}, [], [{{:"$1", :"$2"}}]}
    ])
  end

  @doc """
  Store subscription graph diff once it had arrived.
  """
  def store_subscription_data(client_id, subscription_id, graph_diff) do
    xmin = :ets.lookup_element(@subscriptions_ets, {client_id, subscription_id}, 2)
    pos = :ets.lookup_element(@subscriptions_ets, {client_id, subscription_id}, 4)

    :ets.insert(
      @additional_data_ets,
      {{client_id, xmin, pos, :subscription, subscription_id}, graph_diff, []}
    )
  end

  @doc """
  Store graph diff for additional data that was queried from PostgreSQL in
  response to a set of transactions.
  """
  def store_additional_tx_data(client_id, ref, xmin, pos, included_txns, graph_diff) do
    :ets.insert(
      @additional_data_ets,
      {{client_id, xmin, pos, :transaction, ref}, graph_diff, included_txns}
    )
  end

  defp pop_additional_data_before(client_id, transaction_id) do
    pattern = {{client_id, :"$1", :_, :"$2", :"$3"}, :"$4", :"$5"}
    guard = [{:"=<", :"$1", transaction_id}]
    body = [{{:"$2", :"$3", :"$4", :"$5"}}]

    results = :ets.select(@additional_data_ets, [{pattern, guard, body}])
    :ets.select_delete(@additional_data_ets, [{pattern, guard, [true]}])

    results
  end

  defp clear_stored_actions(client_id, txn_ids) do
    matchspec =
      for id <- txn_ids, do: {{{client_id, id}, :_}, [], [true]}

    :ets.select_delete(@actions_ets, matchspec)
  end

  @impl GenServer
  def init(_) do
    Logger.metadata(component: "ClientReconnectionInfo")
    table1 = :ets.new(@checkpoint_ets, [:named_table, :public, :set])
    table2 = :ets.new(@subscriptions_ets, [:named_table, :public, :ordered_set])
    table3 = :ets.new(@additional_data_ets, [:named_table, :public, :ordered_set])
    table4 = :ets.new(@actions_ets, [:named_table, :public, :set])

    {:ok,
     %{
       checkpoint_table: table1,
       subscriptions_table: table2,
       additional_data_table: table3,
       actions_table: table4
     }}
  end
end
