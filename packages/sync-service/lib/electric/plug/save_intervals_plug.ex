defmodule Electric.Plug.SaveIntervalsPlug do
  alias Electric.Telemetry.OpenTelemetry

  def init(opts), do: opts

  def call(conn, opts) do
    Plug.Conn.register_before_send(conn, fn conn ->
      OpenTelemetry.stop_and_save_intervals(opts)
      conn
    end)
  end
end
