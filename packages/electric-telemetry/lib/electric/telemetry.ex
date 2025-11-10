defmodule Electric.Telemetry do
  require Logger

  @telemetry_enabled? Application.compile_env(:electric_telemetry, :enabled?, false)
  @log_level Application.compile_env(:electric_telemetry, :log_level, false)

  defmacro __using__(_opts) do
    quote do
      import Electric.Telemetry
    end
  end

  # uses the availability of the given dependencies to optionally compile
  # the provided block when MIX_TARGET is `:application`.
  defmacro with_telemetry(dependencies, do: block, else: else_block) do
    include_with_telemetry(__CALLER__, __ENV__, dependencies, block, else_block)
  end

  defmacro with_telemetry(dependencies, do: block) do
    include_with_telemetry(__CALLER__, __ENV__, dependencies, block, nil)
  end

  defp include_with_telemetry(caller, env, dependencies, block, else_block) do
    modules = List.wrap(dependencies) |> Enum.map(&Macro.expand(&1, env))
    telemetry_code_available? = Enum.all?(modules, &Code.ensure_loaded?/1)

    if @telemetry_enabled? && telemetry_code_available? do
      if @log_level do
        Logger.log(
          @log_level,
          "Enabling telemetry in #{caller.module || Path.relative_to(caller.file, Path.expand("..", __DIR__))}"
        )
      end

      quote(do: unquote(block))
    else
      if else_block, do: quote(do: unquote(else_block))
    end
  end

  def scheduler_ids do
    num_schedulers = :erlang.system_info(:schedulers)
    Enum.map(1..num_schedulers, &:"normal_#{&1}") ++ [:cpu, :io]
  end

  @opts_schema NimbleOptions.new!(Electric.Telemetry.Opts.schema())

  def validate_options(user_opts) do
    with {:ok, validated_opts} <- NimbleOptions.validate(user_opts, @opts_schema) do
      config =
        Map.new(validated_opts, fn
          {k, kwlist} when k in [:reporters, :intervals_and_thresholds] -> {k, Map.new(kwlist)}
          kv -> kv
        end)

      {:ok, config}
    end
  end

  def export_enabled?(%{reporters: reporters}) do
    truthy?(
      reporters.statsd_host ||
        reporters.call_home_url ||
        reporters.otel_metrics? ||
        reporters.prometheus?
    )
  end

  defp truthy?(false), do: false
  defp truthy?(nil), do: false
  defp truthy?(_), do: true
end
