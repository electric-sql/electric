defmodule Mix.Tasks.Bench do
  use Mix.Task

  @shortdoc "Run load generation benchmark against Electric + durable streams"

  @moduledoc """
  Starts a load generator that writes to a PostgreSQL `items` table,
  creating one Electric shape per partition, and drives UPDATE traffic
  at a configurable rate.

  The main Electric application must already be running (`iex -S mix`
  or `mix start_dev`). This task connects directly to Postgres and
  creates shapes via the Electric HTTP API.

  ## Usage

      mix bench [options]

  ## Options

      --database-url URL       PostgreSQL connection URL
                               (env: DATABASE_URL,
                                default: postgresql://postgres:password@localhost:54321/electric)

      --electric-url URL       Electric HTTP API base URL
                               (default: http://localhost:3000)

      --table-name NAME        Table to write to
                               (default: items)

      --partitions N           Number of partitions (shapes)
                               (default: 4)

      --row-count N            Number of rows to seed
                               (default: 10000)

      --content-size N         Value column size in bytes
                               (default: 1024)

      --target-tps N           Target transactions per second
                               (default: 100)

      --worker-count N         Number of concurrent load workers
                               (default: 4)

      --pool-size N            Database connection pool size
                               (default: 10)

      --duration N             Run for N seconds then exit (0 = forever)
                               (default: 0)

      --stats-interval N       Print stats every N seconds
                               (default: 5)

  ## Examples

      # Run with defaults (4 partitions, 100 TPS)
      mix bench

      # 16 partitions at 500 TPS with 4KB values
      mix bench --partitions 16 --target-tps 500 --content-size 4096

      # Quick 30-second test
      mix bench --duration 30 --target-tps 200
  """

  @switches [
    database_url: :string,
    electric_url: :string,
    table_name: :string,
    partitions: :integer,
    row_count: :integer,
    content_size: :integer,
    target_tps: :integer,
    worker_count: :integer,
    pool_size: :integer,
    duration: :integer,
    stats_interval: :integer
  ]

  @aliases [
    d: :database_url,
    e: :electric_url,
    p: :partitions,
    r: :row_count,
    s: :content_size,
    n: :target_tps,
    w: :worker_count
  ]

  @defaults %{
    database_url: "postgresql://postgres:password@localhost:54321/electric",
    electric_url: "http://localhost:3000",
    table_name: "items",
    partitions: 4,
    row_count: 10_000,
    content_size: 1_024,
    target_tps: 100,
    worker_count: 4,
    pool_size: 10,
    duration: 0,
    stats_interval: 5
  }

  @impl Mix.Task
  def run(args) do
    {opts, remaining, invalid} =
      OptionParser.parse(args, switches: @switches, aliases: @aliases)

    unless invalid == [] do
      Mix.raise(
        "Unknown option(s): #{Enum.map_join(invalid, ", ", fn {k, _} -> k end)}\n" <>
          "Run `mix help bench` for usage."
      )
    end

    unless remaining == [] do
      Mix.raise(
        "Unexpected argument(s): #{Enum.join(remaining, ", ")}\n" <>
          "Run `mix help bench` for usage."
      )
    end

    config = build_config(opts)

    # Start just the dependencies we need (not the full Electric app)
    Mix.Task.run("app.config")
    Application.ensure_all_started(:postgrex)
    Application.ensure_all_started(:req)

    # Parse database URL and start a connection pool
    uri = URI.parse(config.database_url)
    userinfo = String.split(uri.userinfo || "postgres:password", ":")

    db_opts = [
      hostname: uri.host || "localhost",
      port: uri.port || 5432,
      database: String.trim_leading(uri.path || "/electric", "/"),
      username: Enum.at(userinfo, 0, "postgres"),
      password: Enum.at(userinfo, 1, "password"),
      pool_size: config.pool_size,
      name: Electric.Bench.DB
    ]

    {:ok, _pool} = Postgrex.start_link(db_opts)

    IO.puts("""

    ╔══════════════════════════════════════════════════╗
    ║           Electric Bench — Load Generator        ║
    ╠══════════════════════════════════════════════════╣
    ║  Partitions:    #{String.pad_trailing(to_string(config.partitions), 31)}║
    ║  Target TPS:    #{String.pad_trailing(to_string(config.target_tps), 31)}║
    ║  Workers:       #{String.pad_trailing(to_string(config.worker_count), 31)}║
    ║  Value size:    #{String.pad_trailing("#{config.content_size}B", 31)}║
    ║  Row count:     #{String.pad_trailing(to_string(config.row_count), 31)}║
    ║  Duration:      #{String.pad_trailing(if(config.duration == 0, do: "forever", else: "#{config.duration}s"), 31)}║
    ║  Stats every:   #{String.pad_trailing("#{config.stats_interval}s", 31)}║
    ╚══════════════════════════════════════════════════╝
    """)

    # Start the load generator in a separate process
    {:ok, gen_pid} =
      Task.start_link(fn ->
        Electric.Bench.LoadGenerator.run(
          db_pool: Electric.Bench.DB,
          electric_url: config.electric_url,
          table: config.table_name,
          partitions: config.partitions,
          row_count: config.row_count,
          content_size: config.content_size,
          target_tps: config.target_tps,
          worker_count: config.worker_count
        )
      end)

    # Start the stats poller
    stats_pid =
      spawn_link(fn ->
        stats_loop(config.electric_url, config.stats_interval)
      end)

    # Handle duration
    if config.duration > 0 do
      Process.sleep(config.duration * 1000)
      IO.puts("\n⏱  Duration reached (#{config.duration}s). Shutting down.")
      Process.exit(gen_pid, :shutdown)
      Process.exit(stats_pid, :shutdown)
    else
      Process.sleep(:infinity)
    end
  end

  defp build_config(opts) do
    Enum.reduce(opts, @defaults, fn {key, value}, acc ->
      Map.put(acc, key, value)
    end)
  end

  # ---------------------------------------------------------------------------
  # Stats polling loop
  # ---------------------------------------------------------------------------

  defp stats_loop(electric_url, interval_s) do
    Process.sleep(interval_s * 1000)
    print_stats(electric_url)
    stats_loop(electric_url, interval_s)
  end

  defp print_stats(electric_url) do
    case Req.get("#{electric_url}/debug/stats", receive_timeout: 5_000) do
      {:ok, %Req.Response{status: 200, body: body}} when is_map(body) ->
        format_stats(body)

      {:ok, %Req.Response{status: 200, body: body}} when is_binary(body) ->
        case Jason.decode(body) do
          {:ok, parsed} -> format_stats(parsed)
          _ -> IO.puts("[stats] Could not parse response")
        end

      {:ok, %Req.Response{status: status}} ->
        IO.puts("[stats] HTTP #{status}")

      {:error, reason} ->
        IO.puts("[stats] Error: #{inspect(reason)}")
    end
  rescue
    e -> IO.puts("[stats] Error: #{Exception.message(e)}")
  end

  defp format_stats(stats) do
    now = Map.get(stats, "timestamp", "?")
    wal = Map.get(stats, "wal_buffer", %{})
    pipeline = Map.get(stats, "pipeline", %{})
    writers = Map.get(stats, "writers", [])
    shapes = Map.get(stats, "shapes", %{})

    total_acked = writers |> Enum.map(&Map.get(&1, "total_acked", 0)) |> Enum.sum()
    total_errors = writers |> Enum.map(&Map.get(&1, "total_errors", 0)) |> Enum.sum()
    dirty = writers |> Enum.map(&Map.get(&1, "dirty_shapes", 0)) |> Enum.sum()

    slc = Map.get(stats, "shape_log_collector", %{})

    IO.puts("""
    ── #{now} ──────────────────────────────────
      WAL buffer:      #{Map.get(wal, "entries", "?")} entries, #{if Map.get(wal, "full"), do: "FULL", else: "ok"}
      Shapes:          #{Map.get(shapes, "total", "?")}
      Writers:         acked=#{total_acked} errors=#{total_errors} dirty=#{dirty}
      SLC per-event:   #{format_latency(slc)}
      Consumer:        #{format_latency(Map.get(pipeline, "consumer", %{}))}
      Queue wait:      #{format_latency(Map.get(pipeline, "queue_wait", %{}))}
      HTTP:            #{format_latency(Map.get(pipeline, "http", %{}))}
      Total (e2e):     #{format_latency(Map.get(pipeline, "total", %{}))}
    """)
  end

  defp format_latency(lat) do
    cond do
      Map.get(lat, "count", 0) == 0 ->
        "no samples"

      Map.has_key?(lat, "p50_us") ->
        "p50=#{lat["p50_us"]}µs p99=#{lat["p99_us"]}µs max=#{lat["max_us"]}µs (n=#{lat["count"]})"

      true ->
        "p50=#{lat["p50_ms"]}ms p99=#{lat["p99_ms"]}ms max=#{lat["max_ms"]}ms (n=#{lat["count"]})"
    end
  end
end
