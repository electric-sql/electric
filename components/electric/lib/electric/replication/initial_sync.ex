defmodule Electric.Replication.InitialSync do
  @moduledoc """
  Initial sync of migrations and data.

  This module relies on the functionality provided by Postgres.Extension to fetch all "electrified" tables, migration
  history, etc.
  """

  alias Electric.Replication.Shapes
  alias Electric.Postgres.{CachedWal, Extension, Lsn}
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
  @spec migrations_since(nil | String.t(), Keyword.t(), CachedWal.Api.wal_pos()) :: [
          Transaction.t()
        ]
  def migrations_since(version, connector_opts, lsn \\ 0) do
    {:ok, migrations} = Extension.SchemaCache.migration_history(version)
    origin = Connectors.origin(connector_opts)
    publication = Extension.publication_name()

    for {txid, txts, version, _schema, stmts} <- migrations do
      records =
        for sql <- stmts do
          %NewRecord{
            relation: Extension.ddl_relation(),
            record: %{"version" => version, "query" => sql, "txid" => txid, "txts" => txts}
          }
        end

      %Transaction{
        xid: txid,
        changes: records,
        commit_timestamp: txts,
        origin: origin,
        publication: publication,
        lsn: lsn,
        ack_fn: fn -> :ok end
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

  1. `{:subscription_insertion_point, ^ref, xmin}` is sent immediately to know where to insert
     results when they are ready. That message **has** to be sent ASAP since if we send the results
     at the end, we might have already skipped the point where the data is relevant.
  2. `{:subscription_data, subscription_id, observed_lsn, data}` is when we've collected all the data.
     The `observed_lsn` here is a cheat-code to sidestep an issue where there were no transactions.
     It's required, because if we haven't received any transactions while querying, we don't have
     any transactions to trigger sending this data in `Electric.Satellite.WsServer`, so we're using
     this LSN point only for equality checking if we haven't moved at all.

  If an error occurs while collecting the data, this function is expected to send the message like this:
  ```elixir
  {:subscription_init_failed, subscription_id, reason}
  ```
  """
  def query_subscription_data({subscription_id, requests},
        reply_to: {ref, parent},
        connection: opts
      ) do
    Client.with_conn(Connectors.get_connection_opts(opts), fn conn ->
      origin = Connectors.origin(opts)
      {:ok, _, schema} = Extension.SchemaCache.load(origin)

      :epgsql.with_transaction(
        conn,
        fn conn ->
          {:ok, _, [{xmin, end_of_tx_lsn}]} =
            :epgsql.squery(
              conn,
              "SELECT pg_snapshot_xmin(pg_current_snapshot()), pg_current_wal_lsn();"
            )

          send(parent, {:subscription_insertion_point, ref, String.to_integer(xmin)})

          wal_pos =
            end_of_tx_lsn
            |> Lsn.from_string()
            |> CachedWal.EtsBacked.lsn_to_position()

          Enum.reduce_while(requests, [], fn request, results ->
            case Shapes.ShapeRequest.query_initial_data(request, conn, schema, origin) do
              {:ok, data} -> {:cont, [{request.id, data} | results]}
              {:error, reason} -> {:halt, {:error, reason}}
            end
          end)
          |> case do
            {:error, reason} ->
              send(parent, {:subscription_init_failed, subscription_id, reason})

            results ->
              send(parent, {:subscription_data, subscription_id, wal_pos, results})
          end
        end,
        begin_opts: "ISOLATION LEVEL REPEATABLE READ READ ONLY"
      )
    end)
  end
end
