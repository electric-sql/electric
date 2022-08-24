defmodule Electric.Replication.VaxinePostgresOffsetStorage do
  @moduledoc """
  Public interface for replication state storage

  The server process starts the storage and does occasional garbage collection
  """
  use GenServer
  require Logger

  alias Electric.Postgres.Lsn

  @table Module.concat([__MODULE__, Table])

  @default_file Application.compile_env!(:electric, __MODULE__)
                |> Keyword.fetch!(:file)
                |> String.to_charlist()

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts)
  end

  def init(opts) do
    opts = Keyword.merge([file: @default_file, type: :set], opts)
    dets = :dets.open_file(@table, opts)

    {:ok, dets}
  end

  def put_relation(slot, lsn, vx_offset) do
    Logger.info("Saving offset #{inspect(vx_offset)} for lsn #{inspect(lsn)}")
    :ok = :dets.insert(@table, {{slot, lsn}, vx_offset})
    :dets.sync(@table)
  end

  def get_vx_offset(slot, lsn) do
    case :dets.lookup(@table, {slot, lsn}) do
      [] -> nil
      [{{_slot, _lsn}, vx_offset}] -> vx_offset
    end
  end

  # FIXME: could stream + reduce to reduce memory footprint in case of large
  # datasets
  def get_largest_known_lsn_smaller_than(slot, max) do
    @table
    |> :dets.select([{{{:"$1", :"$2"}, :"$3"}, [{:==, :"$1", slot}], [{{:"$2", :"$3"}}]}])
    |> Enum.filter(fn {lsn1, _} -> Lsn.compare(lsn1, max) != :gt end)
    |> case do
      [] ->
        nil

      results ->
        Enum.max(results, fn {lsn1, _}, {lsn2, _} ->
          Lsn.compare(lsn1, lsn2) != :lt
        end)
    end
  end

  # TODO: :)
  def garbage_collect_relations() do
    raise ArgumentError, "not implemented"
  end

  def terminate(_reason) do
    Logger.info("Syncing storage")
    :dets.sync(@table)
  end
end
