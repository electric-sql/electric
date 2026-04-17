defmodule Electric.Bench.LoadGenerator do
  @moduledoc """
  Drives write load against a PostgreSQL `items` table partitioned by
  an integer `partition` column.

  Two phases:
    1. **Setup** — creates shapes in Electric for each partition by requesting
       `GET /v1/shape?table=items&offset=-1&where=partition=N`
    2. **Seed** — inserts `row_count` rows distributed across partitions
    3. **Update loop** — `worker_count` concurrent tasks each continuously
       UPDATE random rows at the configured `target_tps` rate

  Rate control uses a deterministic token-bucket approach: each worker
  targets `target_tps / worker_count` TPS independently.
  """

  use Task, restart: :permanent

  require Logger

  # ---------------------------------------------------------------------------
  # Rate-control helpers
  # ---------------------------------------------------------------------------

  defmodule RateLimit do
    @moduledoc false

    def init(tps) when tps > 0 do
      interval_us = trunc(1_000_000 / tps)
      %{interval_us: interval_us, next_at: now_us()}
    end

    def wait(%{interval_us: interval_us, next_at: next_at} = state) do
      now = now_us()
      wait_us = next_at - now

      if wait_us > 0 do
        Process.sleep(div(wait_us, 1000))
      end

      %{state | next_at: max(now, next_at) + interval_us}
    end

    defp now_us, do: System.monotonic_time(:microsecond)
  end

  # ---------------------------------------------------------------------------
  # Public API
  # ---------------------------------------------------------------------------

  def start_link(opts) do
    Task.start_link(__MODULE__, :run, [opts])
  end

  def run(opts) do
    db_pool = Keyword.fetch!(opts, :db_pool)
    electric_url = Keyword.get(opts, :electric_url, "http://localhost:3000")
    table = Keyword.get(opts, :table, "items")
    partitions = Keyword.get(opts, :partitions, 4)
    row_count = Keyword.get(opts, :row_count, 10_000)
    content_size = Keyword.get(opts, :content_size, 1_024)
    target_tps = Keyword.get(opts, :target_tps, 100)
    worker_count = Keyword.get(opts, :worker_count, 4)

    Logger.info("""
    LoadGenerator config:
      table:        #{table}
      partitions:   #{partitions}
      row_count:    #{row_count}
      content_size: #{content_size}B
      target_tps:   #{target_tps}
      workers:      #{worker_count}
      electric_url: #{electric_url}
    """)

    ensure_table(db_pool, table)

    # Create shapes and seed data concurrently so that replication
    # data starts flowing through Electric while shapes are being created.
    shape_task = Task.async(fn -> create_shapes(electric_url, table, partitions) end)
    seed_task = Task.async(fn -> seed(db_pool, table, partitions, row_count, content_size) end)
    Task.await(shape_task, :infinity)
    Task.await(seed_task, :infinity)

    Logger.info(
      "Seed complete. Starting #{worker_count} update workers at #{target_tps} TPS total..."
    )

    tps_per_worker = max(target_tps / worker_count, 0.1)
    run_updates(db_pool, table, partitions, row_count, content_size, tps_per_worker, worker_count)
  end

  # ---------------------------------------------------------------------------
  # Setup: ensure table and create shapes
  # ---------------------------------------------------------------------------

  defp ensure_table(db_pool, table) do
    Postgrex.query!(db_pool, """
      CREATE TABLE IF NOT EXISTS "#{table}" (
        id serial8 NOT NULL PRIMARY KEY,
        value text,
        partition int
      )
    """, [])

    Logger.info("Table #{table} ready")
  end

  defp create_shapes(electric_url, table, partitions) do
    Logger.info("Creating #{partitions} shapes in Electric (in parallel)...")

    1..partitions
    |> Task.async_stream(
      fn p -> create_shape(electric_url, table, p) end,
      max_concurrency: partitions,
      timeout: :infinity,
      ordered: false
    )
    |> Stream.run()

    Logger.info("All #{partitions} shapes requested")
  end

  defp create_shape(electric_url, table, p) do
    url = "#{electric_url}/v1/shape?table=#{table}&offset=-1&where=partition%3D#{p}"

    case Req.get(url, receive_timeout: 30_000) do
      {:ok, %Req.Response{status: status}} when status in 200..299 ->
        Logger.debug("Shape for partition #{p} created (HTTP #{status})")

      {:ok, %Req.Response{status: status, body: body}} ->
        Logger.warning("Shape for partition #{p} returned HTTP #{status}: #{inspect(body)}")

      {:error, reason} ->
        Logger.warning("Failed to create shape for partition #{p}: #{inspect(reason)}")
    end
  end

  # ---------------------------------------------------------------------------
  # Phase 1: Seed — ensure exactly row_count rows exist
  # ---------------------------------------------------------------------------

  defp seed(db_pool, table, partitions, row_count, content_size) do
    %{rows: [[existing]]} =
      Postgrex.query!(db_pool, ~s|SELECT count(*) FROM "#{table}"|, [])

    if existing >= row_count do
      Logger.info("Table already has #{existing} rows (need #{row_count}), skipping seed")
    else
      needed = row_count - existing
      Logger.info("Seeding #{needed} rows (#{existing} exist, need #{row_count})...")

      concurrency = min(needed, 20)

      1..needed
      |> Task.async_stream(
        fn i ->
          partition = rem(i - 1, partitions) + 1
          content = random_content(content_size)

          Postgrex.query!(
            db_pool,
            ~s|INSERT INTO "#{table}" (value, partition) VALUES ($1, $2)|,
            [content, partition]
          )
        end,
        max_concurrency: concurrency,
        timeout: :infinity,
        ordered: false
      )
      |> Stream.run()

      Logger.info("Seeded #{needed} rows (total now #{row_count})")
    end
  end

  # ---------------------------------------------------------------------------
  # Phase 2: Update loop
  # ---------------------------------------------------------------------------

  defp run_updates(db_pool, table, partitions, row_count, content_size, tps_per_worker, worker_count) do
    tasks =
      for worker_id <- 1..worker_count do
        Task.async(fn ->
          update_loop(db_pool, table, partitions, row_count, content_size, tps_per_worker, worker_id)
        end)
      end

    Task.await_many(tasks, :infinity)
  end

  defp update_loop(db_pool, table, partitions, row_count, content_size, tps, _worker_id) do
    rate = RateLimit.init(tps)
    do_update_loop(db_pool, table, partitions, row_count, content_size, rate)
  end

  defp do_update_loop(db_pool, table, partitions, row_count, content_size, rate) do
    rate = RateLimit.wait(rate)

    id = :rand.uniform(row_count)
    partition = rem(:rand.uniform(1_000_000), partitions) + 1
    content = random_content(content_size)

    Postgrex.query!(
      db_pool,
      ~s|UPDATE "#{table}" SET value = $1, partition = $2 WHERE id = $3|,
      [content, partition, id]
    )

    do_update_loop(db_pool, table, partitions, row_count, content_size, rate)
  end

  # ---------------------------------------------------------------------------
  # Helpers
  # ---------------------------------------------------------------------------

  defp random_content(size) do
    raw = :crypto.strong_rand_bytes(ceil(size * 3 / 4))
    content = Base.encode64(raw, padding: false)
    binary_part(content, 0, min(byte_size(content), size))
  end
end
