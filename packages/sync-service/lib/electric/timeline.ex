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

  @type check_result :: :ok | :timeline_changed

  @doc """
  Checks that we're connected to the same Postgres DB as before and on the same timeline.
  TO this end, it checks the provided `pg_id` against the persisted PG ID.
  If the PG IDs match, it also checks the provided `pg_timeline` against the persisted timeline.
  Normally, Postgres and Electric are on the same timeline and nothing must be done.
  If the timelines differ, that indicates that a Point In Time Recovery (PITR) has occurred and all shapes must be cleaned.
  If we fail to fetch timeline information, we also clean all shapes for safety as we can't be sure that Postgres and Electric are on the same timeline.
  """
  @spec check(timeline(), keyword()) :: check_result()
  def check(pg_timeline, opts) do
    electric_timeline = load_timeline(opts)

    # In any situation where the newly fetched timeline is different from the one we had
    # stored previously, overwrite the old one with the new one in our persistent KV store.
    if pg_timeline != electric_timeline do
      :ok = store_timeline(pg_timeline, opts)
    end

    # Now check for specific differences between the two timelines.
    verify_timeline(pg_timeline, electric_timeline)
  end

  @spec verify_timeline(timeline(), timeline()) :: check_result()
  defp verify_timeline({pg_id, timeline_id} = timeline, timeline) do
    Logger.info("Connected to Postgres #{pg_id} and timeline #{timeline_id}")
    :ok
  end

  defp verify_timeline({pg_id, timeline_id}, nil) do
    Logger.info("No previous timeline detected.")
    Logger.info("Connected to Postgres #{pg_id} and timeline #{timeline_id}")
    :ok
  end

  defp verify_timeline({pg_id, _}, {electric_pg_id, _}) when pg_id != electric_pg_id do
    Logger.warning(
      "Detected different Postgres DB, with ID: #{pg_id}. Old Postgres DB had ID #{electric_pg_id}. Will purge all shapes."
    )

    :timeline_changed
  end

  defp verify_timeline({_, timeline_id}, _) do
    Logger.warning("Detected PITR to timeline #{timeline_id}; will purge all shapes.")
    :timeline_changed
  end

  # Loads the PG ID and timeline ID from persistent storage
  @spec load_timeline(Keyword.t()) :: timeline()
  def load_timeline(opts) do
    kv = make_serialized_kv(opts)

    case PersistentKV.get(kv, timeline_key(opts)) do
      {:ok, [pg_id, timeline_id]} ->
        {pg_id, timeline_id}

      {:error, :not_found} ->
        nil

      error ->
        Logger.warning("Failed to load timeline ID from persistent storage: #{inspect(error)}")
        nil
    end
  end

  @spec store_timeline(timeline(), Keyword.t()) :: :ok
  def store_timeline({pg_id, timeline_id}, opts) do
    kv = make_serialized_kv(opts)
    :ok = PersistentKV.set(kv, timeline_key(opts), [pg_id, timeline_id])
  end

  defp make_serialized_kv(opts) do
    kv_backend = Keyword.fetch!(opts, :persistent_kv)
    # defaults to using Jason encoder and decoder
    PersistentKV.Serialized.new!(backend: kv_backend)
  end

  defp timeline_key(opts) do
    tenant_id = Access.fetch!(opts, :tenant_id)
    "timeline_id_#{tenant_id}"
  end
end
