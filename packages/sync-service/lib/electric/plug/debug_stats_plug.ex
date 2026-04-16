defmodule Electric.Plug.DebugStatsPlug do
  @moduledoc """
  Returns a JSON snapshot of durable streams pipeline stats.

  Designed for benchmarking and load testing — pollable via curl:

      watch -n1 'curl -s localhost:3000/debug/stats | jq .'
  """

  @behaviour Plug

  require Logger

  @impl Plug
  def init(opts), do: opts

  @impl Plug
  def call(conn, _opts) do
    stack_id = conn.assigns.config[:stack_id]
    stats = collect_stats(stack_id)

    conn
    |> Plug.Conn.put_resp_content_type("application/json")
    |> Plug.Conn.send_resp(200, Jason.encode!(stats))
  end

  defp collect_stats(stack_id) do
    %{
      timestamp: DateTime.utc_now() |> DateTime.to_iso8601(),
      wal_buffer: wal_buffer_stats(stack_id),
      replication: replication_stats(stack_id),
      shapes: shape_stats(stack_id),
      writers: writer_stats(stack_id),
      pipeline: pipeline_stats(stack_id)
    }
  end

  defp wal_buffer_stats(stack_id) do
    Electric.Replication.WalBuffer.stats(stack_id)
  rescue
    _ -> %{error: "not_available"}
  end

  defp replication_stats(stack_id) do
    alias Electric.Postgres.ReplicationClient

    case GenServer.whereis(ReplicationClient.name(stack_id)) do
      nil ->
        %{status: "not_running"}

      _pid ->
        last_lsn = Electric.LsnTracker.get_last_processed_lsn(stack_id)

        %{
          last_processed_lsn: if(last_lsn, do: to_string(last_lsn), else: nil)
        }
    end
  rescue
    _ -> %{error: "not_available"}
  end

  defp shape_stats(stack_id) do
    case Electric.ShapeCache.list_shapes(stack_id) do
      shapes when is_list(shapes) ->
        %{
          total: length(shapes),
          handles: Enum.map(shapes, fn {handle, _shape} -> handle end)
        }

      _ ->
        %{total: 0}
    end
  rescue
    _ -> %{total: 0, error: "not_available"}
  end

  defp writer_stats(stack_id) do
    num_writers = Electric.StackConfig.lookup(stack_id, :durable_streams_writer_pool_size, 4)

    Enum.map(0..(num_writers - 1), fn i ->
      Electric.DurableStreams.Writer.stats(stack_id, i)
    end)
  rescue
    _ -> []
  end

  defp pipeline_stats(stack_id) do
    Electric.DurableStreams.Stats.get_stats(stack_id)
  rescue
    _ -> %{pipeline_latency: %{count: 0, error: "not_available"}}
  end
end
