defmodule Electric.Replication.InitialSync do
  @moduledoc """
  Initial sync of migrations and data.

  This module relies on the functionality provided by Postgres.Extension to fetch all "electrified" tables, migration
  history, etc.
  """

  alias Electric.Utils
  alias Electric.Telemetry.Metrics
  alias Electric.Replication.Shapes
  alias Electric.Postgres.{CachedWal, Extension}
  alias Electric.Replication.Changes.{NewRecord, Transaction}
  alias Electric.Replication.Connectors
  alias Electric.Replication.Postgres.Client

  @doc """
  Get a list of transactions that, taken together, represent the current state of the Postgres database.

  The list always starts with migration transactions, followed by a single data transaction that includes all of the
  data the client can access.

  All table data are fetched in a single REPEATABLE READ transaction to ensure consisency between all tables.

  The LSN returned along with the list of transactions corresponds to the latest known cached LSN just prior to starting
  the data fetching.
  """
  @spec migrations_since(nil | String.t(), Connectors.origin(), CachedWal.Api.wal_pos()) :: [
          Transaction.t()
        ]
  def migrations_since(version, origin, lsn \\ 0) do
    publication = Extension.publication_name()
    {:ok, migrations} = Extension.SchemaCache.migration_history(origin, version)

    for migration <- migrations do
      records =
        for sql <- migration.stmts do
          %NewRecord{
            relation: Extension.ddl_relation(),
            record: %{
              "version" => migration.version,
              "query" => sql,
              "txid" => migration.txid,
              "txts" => migration.txts
            }
          }
        end

      %Transaction{
        xid: migration.txid,
        changes: records,
        commit_timestamp: migration.timestamp,
        origin: origin,
        publication: publication,
        lsn: lsn
      }
    end
  end

  @doc """
  Request initial data for a subscription.

  Queries fulfilling the request are ran in a transaction with `ISOLATION LEVEL REPEATABLE READ`.
  That means that we can run multiple queries and they won't be affected by transactions committed
  between queries. That also means that we can concretely rely on `pg_snapshot_xmin` to be at a point
  where any `id` >= `xmin` would not have been seen. So the insertion point for the data can be defined
  in terms of this `xmin` transaction ID: we know that we can continue streaming transactions while their
  ids are less than `xmin`, and when we reach that "tipping point", we need to send this data before continuing.

  This function is expected to send two messages to `parent` process which is the satellite websocket:

  1. `{:data_insertion_point, ^ref, xmin}` is sent immediately to know where to insert
     results when they are ready. That message **has** to be sent ASAP since if we send the results
     at the end, we might have already skipped the point where the data is relevant.
  2. `{:subscription_data, subscription_id, data}` is when we've collected all the data.

  If an error occurs while collecting the data, this function is expected to send the following message:

      {:subscription_init_failed, subscription_id, reason}

  Sidenote: since the insertion point for initial data is the first observed transaction that has
  xid >= xmin, we make sure there is one even in the absence of user writes to Postgres. See
  `perform_magic_write/2` below for details.
  """
  def query_subscription_data({subscription_id, requests, context},
        reply_to: {ref, parent},
        origin: origin,
        telemetry_span: span
      ) do
    marker = "subscription:" <> subscription_id
    {:ok, schema_version} = Extension.SchemaCache.load(origin)

    run_in_readonly_txn_with_checkpoint(origin, {ref, parent}, marker, fn _xmin ->
      Enum.reduce_while(requests, {Graph.new(), %{}, []}, fn request,
                                                             {acc_graph, results, req_ids} ->
        start = System.monotonic_time()

        case Shapes.ShapeRequest.query_initial_data(
               request,
               schema_version,
               origin,
               context
             ) do
          {:ok, data, graph} ->
            Metrics.span_event(
              span,
              :shape_data,
              %{duration: System.monotonic_time() - start},
              %{shape_hash: request.hash}
            )

            {:cont,
             {Utils.merge_graph_edges(acc_graph, graph),
              Map.merge(results, data, fn _, {change, v1}, {_, v2} -> {change, v1 ++ v2} end),
              [request.id | req_ids]}}

          {:error, reason} ->
            {:halt, {:error, reason}}
        end
      end)
      |> case do
        {:error, reason} ->
          send(parent, {:subscription_init_failed, subscription_id, reason})

        results ->
          send(parent, {:subscription_data, subscription_id, results})
      end
    end)
  end

  def query_after_move_in(move_in_ref, {subquery_map, affected_txs}, context,
        reply_to: {ref, parent},
        origin: origin
      ) do
    marker = "tx_subquery:#{System.monotonic_time()}"
    {:ok, schema_version} = Extension.SchemaCache.load(origin)

    run_in_readonly_txn_with_checkpoint(origin, {ref, parent}, marker, fn xmin ->
      Enum.reduce_while(subquery_map, {Graph.new(), %{}}, fn {layer, changes},
                                                             {acc_graph, results} ->
        case Shapes.ShapeRequest.query_moved_in_layer_data(
               layer,
               changes,
               schema_version,
               origin,
               context
             ) do
          {:ok, _, data, graph} ->
            {:cont,
             {Utils.merge_graph_edges(acc_graph, graph),
              Map.merge(results, data, fn _, {change, v1}, {_, v2} -> {change, v1 ++ v2} end)}}

          {:error, reason} ->
            {:halt, {:error, reason}}
        end
      end)
      |> case do
        {:error, reason} ->
          send(parent, {:move_in_query_failed, move_in_ref, reason})

        results ->
          send(parent, {:move_in_query_data, move_in_ref, xmin, results, affected_txs})
      end
    end)
  end

  defp run_in_readonly_txn_with_checkpoint(origin, {ref, parent}, marker, fun)
       when is_function(fun, 1) do
    Client.pooled_transaction(origin, "ISOLATION LEVEL REPEATABLE READ READ ONLY", fn ->
      # It's important that this magic write
      # 1. is made after the current transaction has started
      # 2. is in a separate transaction (thus on a different connection)
      # 3. is before the potentially big read queries to ensure this arrives ASAP on any data size
      Task.start(fn -> perform_magic_write(origin, marker) end)

      %{rows: [{xmin}]} = Client.query!("SELECT pg_snapshot_xmin(pg_current_snapshot())")
      send(parent, {:data_insertion_point, ref, xmin})
      fun.(xmin)
    end)
  end

  @transaction_marker_update_query """
  UPDATE
    #{Extension.transaction_marker_table()}
  SET
    content = jsonb_build_object('xid', pg_current_xact_id(), 'caused_by', $1::text)
  WHERE
    id = 'magic write'
  """

  # Commit a write transaction to ensure Electric sees one even in the absence of user writes
  # to Postgres.
  #
  # When fetching initial data or additional data for a transaction from Postgres, we need to
  # identify the correct insertion point for it to maintain consistency. The only reliable way
  # to have an insertion point is to observe a transaction with xid >= xmin where xmin is
  # greater than all transaction IDs that are either committed and visible to the current
  # transaction.
  #
  # This magic write to a special table under a special key has to be made immediately after
  # starting a REPEATABLE READ transaction. xid for this write transaction will definitely be
  # >= xmin, so even in the absence of user writes to electrified tables, Electric will at
  # least observe this magic write.
  def perform_magic_write(origin, marker) when is_binary(origin) do
    Client.pooled_query!(origin, @transaction_marker_update_query, [marker])
  end
end
