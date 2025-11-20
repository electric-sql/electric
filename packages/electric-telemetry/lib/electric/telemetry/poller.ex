defmodule ElectricTelemetry.Poller do
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
      :builtin -> module.builtin_periodic_measurements(telemetry_opts)
      # These are implemented by telemetry_poller
      f when f in [:memory, :persistent_term, :system_counts, :total_run_queue_lengths] -> [f]
      # Bare function names are assumed to be referring to functions defined in the caller module
      f when is_atom(f) -> {module, f, [telemetry_opts]}
      f when is_function(f, 1) -> {__MODULE__, :user_measurement, [f, telemetry_opts]}
      {m, f, a} when is_atom(m) and is_atom(f) and is_list(a) -> [{m, f, a ++ [telemetry_opts]}]
    end)
  end

  def periodic_measurements(telemetry_opts, module),
    do: module.builtin_periodic_measurements(telemetry_opts)

  # Helper function to enable telemetry_poller to call a user-provided anonymous function
  def user_measurement(f, telemetry_opts), do: f.(telemetry_opts)
end
