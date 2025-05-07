defmodule Electric.TestUtils.ConnectionManagerPing do
  @moduledoc """
  Gen server process that pings the given connection manager periodically and times its response.

  If the manager takes too long to respond, an error will be logged.

  This is used in integration tests to monitor the responsiveness of the connection manager.
  """

  use GenServer

  require Logger

  @ping_interval 100
  @ping_response_time 500

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(opts) do
    manager_name = Keyword.fetch!(opts, :manager_name)
    ping_interval = Keyword.get(opts, :interval, @ping_interval)
    response_time = Keyword.get(opts, :response_time, @ping_response_time)

    state =
      %{
        manager_name: manager_name,
        ping_interval: ping_interval,
        response_time: response_time,
        timer: nil
      }
      |> schedule_ping()

    {:ok, state}
  end

  @impl true
  def handle_info({:timeout, tref, :ping}, %{timer: tref, manager_name: manager} = state) do
    {microsec, :pong} = :timer.tc(Electric.Connection.Manager, :ping, [manager])

    if microsec / 1000 > state.response_time do
      Logger.error(
        "Connection manager took too long to respond to ping: #{format_time(microsec)}"
      )
    else
      Logger.debug("Connection manager process ping, got response after #{format_time(microsec)}")
    end

    state = schedule_ping(state)
    {:noreply, state}
  end

  defp schedule_ping(state) do
    tref = :erlang.start_timer(state.ping_interval, self(), :ping)
    %{state | timer: tref}
  end

  defp format_time(microsec) when microsec < 1000, do: "< 1ms"

  defp format_time(microsec) when microsec >= 1000 and microsec < 1_000_000,
    do: "#{div(microsec, 1000)}ms"

  defp format_time(microsec) when microsec >= 1_000_000, do: "#{microsec / 1_000_000}s"
end
