defmodule ElectricTelemetry.Poller do
  require Logger

  @callback builtin_periodic_measurements(map) :: list()

  def child_spec(telemetry_opts, poller_opts) do
    {callback_module, opts} = Keyword.pop(poller_opts, :callback_module)

    case periodic_measurements(telemetry_opts, callback_module) do
      [] ->
        nil

      measurements ->
        opts =
          Keyword.merge(
            [
              measurements: measurements,
              period: telemetry_opts.intervals_and_thresholds.system_metrics_poll_interval,
              init_delay: :timer.seconds(5)
            ],
            opts
          )

        {:telemetry_poller, opts}
    end
  end

  def periodic_measurements(%{periodic_measurements: measurements} = telemetry_opts, module) do
    Enum.flat_map(measurements, fn
      :builtin ->
        module.builtin_periodic_measurements(telemetry_opts)

      # These are implemented by telemetry_poller
      f when f in [:memory, :persistent_term, :system_counts, :total_run_queue_lengths] ->
        [f]

      # Bare function names are assumed to be referring to functions defined in the caller module
      f when is_atom(f) ->
        [wrap(module, f, [telemetry_opts])]

      f when is_function(f, 1) ->
        [wrap(__MODULE__, :user_measurement, [f, telemetry_opts])]

      {m, f, a} when is_atom(m) and is_atom(f) and is_list(a) ->
        [wrap(m, f, a ++ [telemetry_opts])]
    end)
  end

  def periodic_measurements(telemetry_opts, module),
    do: Enum.map(module.builtin_periodic_measurements(telemetry_opts), &wrap_mfa/1)

  defp wrap_mfa({m, f, a}), do: wrap(m, f, a)
  defp wrap_mfa(other), do: other

  defp wrap(m, f, a), do: {__MODULE__, :safe_invoke, [m, f, a]}

  # Helper function to enable telemetry_poller to call a user-provided anonymous function
  def user_measurement(f, telemetry_opts), do: f.(telemetry_opts)

  @doc """
  Invoke a periodic measurement MFA, absorbing common failure modes.

  `:telemetry_poller` removes a measurement permanently from its polling list
  after the first failure. Wrapping every MFA in `safe_invoke/3` prevents that:
  transient errors (GenServer restart races, ETS tables not yet created, DB
  unavailability) are logged as warnings and swallowed so the measurement keeps
  being polled on subsequent ticks.
  """
  def safe_invoke(m, f, a) do
    apply(m, f, a)
    :ok
  rescue
    ArgumentError ->
      :ok

    e ->
      Logger.warning(
        "Telemetry collector #{inspect(m)}.#{f}/#{length(a)} crashed: " <>
          Exception.message(e)
      )

      :ok
  catch
    :exit, {reason, _} when reason in [:noproc, :timeout, :shutdown, :normal] ->
      :ok

    :exit, reason when reason in [:noproc, :shutdown, :normal] ->
      :ok

    kind, reason ->
      Logger.warning(
        "Telemetry collector #{inspect(m)}.#{f}/#{length(a)} #{kind}: " <>
          inspect(reason)
      )

      :ok
  end
end
