defmodule Electric.Replication.OffsetStorage do
  @moduledoc """
  Public interface for replication state storage

  The server process starts the storage and does occasional garbage collection
  """
  use GenServer
  require Logger

  alias Electric.Satellite.Lsn, as: STLsn

  @table Module.concat([__MODULE__, Table])

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts)
  end

  def init(opts) do
    default_file = Application.fetch_env!(:electric, __MODULE__) |> Keyword.fetch!(:file)

    opts =
      Keyword.merge([file: default_file, type: :set], opts)
      |> Keyword.update!(:file, &String.to_charlist/1)

    dets = :dets.open_file(@table, opts)

    {:ok, dets}
  end

  @spec get_satellite_lsn(String.t()) :: nil | STLsn.t()
  def get_satellite_lsn(satellite_client) do
    case :dets.lookup(@table, {:st, satellite_client}) do
      [] -> nil
      [{{:st, _}, lsn}] -> lsn
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
