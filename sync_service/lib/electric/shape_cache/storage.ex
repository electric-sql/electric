defmodule Electric.ShapeCache.Storage do
  alias Electric.Replication.Changes
  alias Electric.Postgres.Lsn
  @type shape_id :: String.t()
  @type compiled_opts :: term()

  @type log_header :: map()
  @type log_entry :: %{
          key: String.t(),
          value: map(),
          headers: log_header(),
          offset: non_neg_integer()
        }
  @type log :: [log_entry()]

  @type row :: list()

  @doc "Initialize shared options that will be passed to every other callback"
  @callback shared_opts(term()) :: {:ok, compiled_opts()} | {:error, term()}
  @doc "Start any processes required to run the storage backend"
  @callback start_link(compiled_opts()) :: GenServer.on_start()
  @doc "Check if snapshot for a given shape id already exists"
  @callback snapshot_exists?(shape_id(), compiled_opts()) :: boolean()
  @doc "Get the full snapshot for a given shape, also returning the offset this snapshot includes"
  @callback get_snapshot(shape_id(), compiled_opts()) :: {offset :: non_neg_integer(), log()}
  @doc """
  Make a new snapshot for a shape ID based on the meta information about the table and a stream of plain string rows

  Should raise an error if making the snapshot had failed for any reason.
  """
  @doc unstable: "The meta information about the single table is subject to change"
  @callback make_new_snapshot!(
              shape_id(),
              Postgrex.Query.t(),
              Enumerable.t(row()),
              compiled_opts()
            ) :: :ok
  @doc "Append changes from one transaction to the log"
  @callback append_to_log!(
              shape_id(),
              Lsn.t(),
              non_neg_integer(),
              [Changes.change()],
              compiled_opts()
            ) :: :ok
  @doc "Get stream of the log for a shape since a given offset"
  @callback get_log_stream(shape_id(), integer(), compiled_opts()) :: Enumerable.t()
  @doc "Clean up snapshots/logs for a shape id"
  @callback cleanup!(shape_id(), compiled_opts()) :: :ok

  @type storage() :: {module(), compiled_opts()}

  @doc "Check if snapshot for a given shape id already exists"
  @spec snapshot_exists?(shape_id(), storage()) :: boolean()
  def snapshot_exists?(shape_id, {mod, opts}), do: apply(mod, :snapshot_exists?, [shape_id, opts])
  @doc "Get the full snapshot for a given shape, also returning the offset this snapshot includes"
  @spec get_snapshot(shape_id(), storage()) :: {offset :: non_neg_integer(), log()}
  def get_snapshot(shape_id, {mod, opts}), do: apply(mod, :get_snapshot, [shape_id, opts])

  @doc """
  Make a new snapshot for a shape ID based on the meta information about the table and a stream of plain string rows
  """
  @doc unstable: "The meta information about the single table is subject to change"
  @spec make_new_snapshot!(
          shape_id(),
          Postgrex.Query.t(),
          Enumerable.t(row()),
          storage()
        ) :: :ok
  def make_new_snapshot!(shape_id, meta, stream, {mod, opts}),
    do: apply(mod, :make_new_snapshot!, [shape_id, meta, stream, opts])

  @doc "Append changes from one transaction to the log"
  @spec append_to_log!(
          shape_id(),
          Lsn.t(),
          non_neg_integer(),
          [Changes.change()],
          storage()
        ) :: :ok
  def append_to_log!(shape_id, lsn, xid, changes, {mod, opts}),
    do: apply(mod, :append_to_log!, [shape_id, lsn, xid, changes, opts])

  @doc "Get stream of the log for a shape since a given offset"
  @spec get_log_stream(shape_id(), integer(), storage()) :: Enumerable.t()
  def get_log_stream(shape_id, offset, {mod, opts}),
    do: apply(mod, :get_log_stream, [shape_id, offset, opts])

  @doc "Clean up snapshots/logs for a shape id"
  @spec cleanup!(shape_id(), storage()) :: :ok
  def cleanup!(shape_id, {mod, opts}), do: apply(mod, :cleanup!, [shape_id, opts])
end
