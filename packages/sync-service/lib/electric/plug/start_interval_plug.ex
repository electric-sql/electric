defmodule Electric.Plug.StartIntervalPlug do
  alias Electric.Telemetry.OpenTelemetry

  def init(opts) do
    interval_name = Keyword.fetch!(opts, :interval_name)
    %{interval_name: interval_name}
  end

  def call(conn, %{interval_name: interval_name}) do
    OpenTelemetry.start_interval(interval_name)
    conn
  end
end
