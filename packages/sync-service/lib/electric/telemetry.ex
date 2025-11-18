defmodule Electric.Telemetry do
  require Logger

  @log_level Application.compile_env(:electric, :telemetry_log_level, false)

  defmacro __using__(_opts) do
    quote do
      import Electric.Telemetry, only: [with_telemetry: 2]
    end
  end

  # uses the availability of the given dependencies to optionally compile
  # the provided block when telemetry is enabled in the application config
  defmacro with_telemetry(dependencies, do: block, else: else_block) do
    include_with_telemetry(__CALLER__, __ENV__, dependencies, block, else_block)
  end

  defmacro with_telemetry(dependencies, do: block) do
    include_with_telemetry(__CALLER__, __ENV__, dependencies, block, nil)
  end

  defp include_with_telemetry(caller, env, dependencies, block, else_block) do
    modules = List.wrap(dependencies) |> Enum.map(&Macro.expand(&1, env))
    telemetry_code_available? = Enum.all?(modules, &Code.ensure_loaded?/1)

    if Electric.telemetry_enabled?() && telemetry_code_available? do
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
end
