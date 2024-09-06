defmodule Electric.Timeline do
  @moduledoc """
  Module containing helper functions for handling Postgres timelines.
  """
  require Logger
  alias Electric.Shapes
  alias Electric.TimelineCache

  @type timeline :: integer() | nil

  @doc """
  Checks the provided `pg_timeline` against Electric's timeline.
  Normally, Postgres and Electric are on the same timeline and nothing must be done.
  If the timelines differ, that indicates that a Point In Time Recovery (PITR) has occurred and all shapes must be cleaned.
  If we fail to fetch timeline information, we also clean all shapes for safety as we can't be sure that Postgres and Electric are on the same timeline.
  """
  @spec check(timeline(), keyword()) :: :ok
  def check(pg_timeline, opts) do
    cache = Keyword.fetch!(opts, :timeline_cache)
    electric_timeline = TimelineCache.get_timeline(cache)
    handle(pg_timeline, electric_timeline, opts)
  end

  # Handles the different cases of timeline comparison
  @spec handle(timeline(), timeline(), keyword()) :: :ok
  defp handle(nil, _, opts) do
    Logger.warning("Unknown Postgres timeline; rotating shapes.")
    Shapes.clean_all_shapes(opts)
    cache = Keyword.fetch!(opts, :timeline_cache)
    TimelineCache.store_timeline(cache, nil)
  end

  defp handle(pg_timeline_id, electric_timeline_id, _opts)
       when pg_timeline_id == electric_timeline_id do
    Logger.info("Connected to Postgres timeline #{pg_timeline_id}")
    :ok
  end

  defp handle(pg_timeline_id, nil, opts) do
    Logger.info("No previous timeline detected.")
    Logger.info("Connected to Postgres timeline #{pg_timeline_id}")
    # Store new timeline
    cache = Keyword.fetch!(opts, :timeline_cache)
    TimelineCache.store_timeline(cache, pg_timeline_id)
  end

  defp handle(pg_timeline_id, _electric_timeline_id, opts) do
    Logger.info("Detected PITR to timeline #{pg_timeline_id}; rotating shapes.")
    Electric.Shapes.clean_all_shapes(opts)
    # Store new timeline only after all shapes have been cleaned
    cache = Keyword.fetch!(opts, :timeline_cache)
    TimelineCache.store_timeline(cache, pg_timeline_id)
  end
end
