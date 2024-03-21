defmodule Electric.Satellite.SentGraphManager do
  @moduledoc """
  Store sent graphs with checkpoints and continuations.

  `Electric.Satellite.Protocol` relies on maintaining a sent rows graph for
  shapes & permissions to function properly. For this to work across client
  reconnects, we need to persist this sent rows graph somewhere on the same
  lifetime as `Electric.Postgres.CachedWal` - it's the cache that's currently
  the bounding factor for "quick" reconnection.

  Just storing the graph in ETS is not enough, however, since the server process
  sees the graph from the point of sent rows, but when the client reconnects,
  it may ask to reconnect at a point in the past & we may need to reprocess some
  transactions. To fix this issue, we're storing a graph at a point where the
  client had acknowledged a transaction, and if the client reconnects at some
  point after the checkpoint, we just replay the transaction processing until
  we get to the same point.

  ## ETS table info

  Since we need to update the client's graph quite often - on each ack - but
  we only need to read the graph on client reconnection, the table is public
  so that we don't need to copy large graphs into this process just to write
  to ETS and discard. For that same reason the table is tuned for write concurrency,
  since rows are keyed by the client and it's guaranteed that only one WebSocket
  process exists per client ID.

  The row structure is described in the `t:row()` in this module.
  """
  alias Electric.Postgres.CachedWal

  use GenServer
  @ets_table :saved_sent_graphs

  @type row ::
          {clientID :: String.t(), lastAckedLSN :: CachedWal.Api.wal_pos(), graph :: Graph.t()}

  def start_link(_) do
    GenServer.start_link(__MODULE__, [], name: __MODULE__)
  end

  def store_graph(client_id, lsn, graph) do
    :ets.insert(@ets_table, {client_id, lsn, graph})
  end

  @spec fetch_graph(String.t()) :: {:ok, row()} | :error
  def fetch_graph(client_id) do
    case :ets.lookup(@ets_table, client_id) do
      [result] -> {:ok, result}
      [] -> :error
    end
  end

  @impl GenServer
  def init(_) do
    Logger.metadata(component: "SentGraphManager")
    table = :ets.new(@ets_table, [:named_table, :public, :set, write_concurrency: true])
    {:ok, %{table: table}}
  end
end
