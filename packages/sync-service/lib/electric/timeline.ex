defmodule Electric.Timeline do
  @moduledoc """
  Module exporting functions for handling Postgres timelines.
  Verifies the Postgres ID and its timeline.
  """
  require Logger
  alias Electric.PersistentKV

  @type pg_id :: non_neg_integer()
  @type timeline_id :: integer()
  @type timeline :: {pg_id(), timeline_id()} | nil

  @timeline_key "timeline_id"

  @doc """
  Checks that we're connected to the same Postgres DB as before and on the same timeline.
  TO this end, it checks the provided `pg_id` against the persisted PG ID.
  If the PG IDs match, it also checks the provided `pg_timeline` against the persisted timeline.
  Normally, Postgres and Electric are on the same timeline and nothing must be done.
  If the timelines differ, that indicates that a Point In Time Recovery (PITR) has occurred and all shapes must be cleaned.
  If we fail to fetch timeline information, we also clean all shapes for safety as we can't be sure that Postgres and Electric are on the same timeline.
  """
  @spec check(timeline(), keyword()) :: :ok
  def check(pg_timeline, opts) do
    electric_timeline = load_timeline(opts)
    verify_timeline(pg_timeline, electric_timeline, opts)
  end

  @spec verify_timeline(timeline(), timeline(), keyword()) :: :ok
  defp verify_timeline({pg_id, timeline_id} = timeline, timeline, _) do
    Logger.info("Connected to Postgres #{pg_id} and timeline #{timeline_id}")
    :ok
  end

  defp verify_timeline({pg_id, timeline_id} = timeline, nil, opts) do
    Logger.info("No previous timeline detected.")
    Logger.info("Connected to Postgres #{pg_id} and timeline #{timeline_id}")
    store_timeline(timeline, opts)
  end

  defp verify_timeline({pg_id, _} = timeline, {electric_pg_id, _}, opts)
       when pg_id != electric_pg_id do
    Logger.warning(
      "Detected different Postgres DB, with ID: #{pg_id}. Old Postgres DB had ID #{electric_pg_id}. Cleaning all shapes."
    )

    clean_all_shapes_and_store_timeline(timeline, opts)
  end

  defp verify_timeline({_, timeline_id} = timeline, _, opts) do
    Logger.warning("Detected PITR to timeline #{timeline_id}; cleaning all shapes.")
    clean_all_shapes_and_store_timeline(timeline, opts)
  end

  defp clean_all_shapes_and_store_timeline(timeline, opts) do
    clean_all_shapes(opts)
    store_timeline(timeline, opts)
  end

  # Loads the PG ID and timeline ID from persistent storage
  @spec load_timeline(keyword()) :: timeline()
  def load_timeline(opts) do
    kv = make_serialized_kv(opts)

    case PersistentKV.get(kv, @timeline_key) do
      {:ok, [pg_id, timeline_id]} ->
        {pg_id, timeline_id}

      {:error, :not_found} ->
        nil

      error ->
        Logger.warning("Failed to load timeline ID from persistent storage: #{error}")
        nil
    end
  end

  def store_timeline({pg_id, timeline_id}, opts) do
    kv = make_serialized_kv(opts)
    :ok = PersistentKV.set(kv, @timeline_key, [pg_id, timeline_id])
  end

  defp make_serialized_kv(opts) do
    kv_backend = Keyword.fetch!(opts, :persistent_kv)
    # defaults to using Jason encoder and decoder
    PersistentKV.Serialized.new!(backend: kv_backend)
  end

  # Clean up all data (meta data and shape log + snapshot) associated with all shapes
  @spec clean_all_shapes(keyword()) :: :ok
  defp clean_all_shapes(opts) do
    {shape_cache, opts} = Access.get(opts, :shape_cache, {ShapeCache, []})
    shape_cache.clean_all_shapes(opts)
    :ok
  end
end
