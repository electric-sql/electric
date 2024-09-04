defmodule Electric.Timeline do
  @moduledoc """
  Genserver that tracks the Postgres timeline ID.
  Module exporting functions for handling Postgres timelines.
  """
  require Logger
  alias Electric.Shapes
  alias Electric.PersistentKV

  @type timeline :: integer() | nil

  @timeline_key "timeline_id"

  @doc """
  Checks the provided `pg_timeline` against Electric's timeline.
  Normally, Postgres and Electric are on the same timeline and nothing must be done.
  If the timelines differ, that indicates that a Point In Time Recovery (PITR) has occurred and all shapes must be cleaned.
  If we fail to fetch timeline information, we also clean all shapes for safety as we can't be sure that Postgres and Electric are on the same timeline.
  """
  @spec check(timeline(), keyword()) :: :ok
  def check(pg_timeline, opts) do
    electric_timeline = load_timeline(opts)
    verify_timeline(pg_timeline, electric_timeline, opts)
  end

  # Handles the different cases of timeline comparison
  @spec verify_timeline(timeline(), timeline(), keyword()) :: :ok
  defp verify_timeline(nil, _, opts) do
    Logger.warning("Unknown Postgres timeline; rotating shapes.")
    Shapes.clean_all_shapes(opts)
    store_timeline(nil, opts)
  end

  defp verify_timeline(timeline_id, timeline_id, _opts) do
    Logger.info("Connected to Postgres timeline #{timeline_id}")
    :ok
  end

  defp verify_timeline(pg_timeline_id, nil, opts) do
    Logger.info("No previous timeline detected.")
    Logger.info("Connected to Postgres timeline #{pg_timeline_id}")
    # Store new timeline
    store_timeline(pg_timeline_id, opts)
  end

  defp verify_timeline(pg_timeline_id, _, opts) do
    Logger.info("Detected PITR to timeline #{pg_timeline_id}; rotating shapes.")
    Electric.Shapes.clean_all_shapes(opts)
    # Store new timeline only after all shapes have been cleaned
    store_timeline(pg_timeline_id, opts)
  end

  # Loads the timeline ID from persistent storage
  @spec load_timeline(keyword()) :: timeline()
  def load_timeline(opts) do
    kv = make_serialized_kv(opts)

    case PersistentKV.get(kv, @timeline_key) do
      {:ok, timeline_id} ->
        timeline_id

      {:error, :not_found} ->
        nil

      error ->
        Logger.warning("Failed to load timeline ID from persistent storage: #{error}")
        nil
    end
  end

  defp store_timeline(timeline_id, opts) do
    kv = make_serialized_kv(opts)
    :ok = PersistentKV.set(kv, @timeline_key, timeline_id)
  end

  defp make_serialized_kv(opts) do
    kv_backend = Keyword.fetch!(opts, :persistent_kv)
    # defaults to using Jason encoder and decoder
    PersistentKV.Serialized.new!(backend: kv_backend)
  end
end
