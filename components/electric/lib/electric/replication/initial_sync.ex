defmodule Electric.Replication.InitialSync do
  @moduledoc """
  Initial sync of migrations and data.

  This module relies on the functionality provided by Postgres.Extension to fetch all "electrified" tables, migration
  history, etc.
  """

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
  @spec migrations_since(nil | String.t(), Keyword.t(), CachedWal.Api.wal_pos()) :: [
          Transaction.t()
        ]
  def migrations_since(version, connector_opts, lsn \\ 0) do
    origin = Connectors.origin(connector_opts)
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
        commit_timestamp: migration.txts,
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
  2. `{:subscription_data, subscription_id, data}` is when we've collected all the data.

  One more thing this function is expected to do is to record any write to Postgres in a table that is a part
  of our publication (i.e. the Electric will see it) and the table should probably be part of the `electric` schema.

  Since the insertion point for this data is first observed transaction with xid >= xmin, if we receive this data
  and no writes come in after (e.g. when no writes are going on in PG), for example if there are no new writes
  coming, then it's essentially impossible to know whether we are still waiting for any transactions from PG or
  we should send the data immediately. LSNs are unstable, transaction ids can be skipped in cases of transaction
  rollbacks. The only reliable way to have an insertion point is to observe the transaction with xid >= xmin, then
  we can insert the data right before that. We ensure we do observe it by doing a magic no-op write to a special
  table under a special key. Since we are doing this write after starting the REPEATABLE READ transaction, xid for
  the write will definitely be >= xmin, so even in absence of "real" writes to electrified tables, we'll at least
  observe this magic write.

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
          # Do the magic write described in the function docs. It's important that this is
          # 1. after the transaction had started, and
          # 2. in a separate transaction (thus on a different connection), and
          # 3. before the potentially big read queries to ensure this arrives ASAP on any data size
          Task.start(fn -> perform_magic_write(opts, subscription_id) end)

          {:ok, _, [{xmin}]} =
            :epgsql.squery(
              conn,
              "SELECT pg_snapshot_xmin(pg_current_snapshot());"
            )

          send(parent, {:subscription_insertion_point, ref, String.to_integer(xmin)})

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
              send(parent, {:subscription_data, subscription_id, results})
          end
        end,
        begin_opts: "ISOLATION LEVEL REPEATABLE READ READ ONLY"
      )
    end)
  end

  defp perform_magic_write(opts, subscription_id) do
    Connectors.get_connection_opts(opts, replication: false)
    |> Client.with_conn(
      &Extension.update_transaction_marker(&1, "subscription:" <> subscription_id)
    )
  end
end
