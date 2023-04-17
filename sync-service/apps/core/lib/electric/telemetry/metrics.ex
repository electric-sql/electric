defmodule Electric.Telemetry.Metrics do
  def pg_producer_received(origin, type) when type in [:insert, :update, :delete] do
    :telemetry.execute([:electric, :postgres_logical, :received], %{total: 1}, %{
      type: type,
      origin: origin
    })
  end

  def pg_slot_replication_event(origin, data) when is_map(data) do
    :telemetry.execute([:electric, :postgres_slot, :replication], data, %{origin: origin})
  end

  def vaxine_consumer_replication_event(origin, data) when is_map(data) do
    :telemetry.execute([:electric, :vaxine_consumer, :replication], data, %{origin: origin})
  end

  def satellite_connection_event(data) when is_map(data) do
    :telemetry.execute([:electric, :satellite, :connection], data)
  end

  def satellite_replication_event(data) when is_map(data) do
    :telemetry.execute([:electric, :satellite, :replication], data)
  end
end
