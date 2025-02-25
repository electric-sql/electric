defmodule Electric.Telemetry do
  require Logger

  # We need to test first if we're in the telemetry-enabled target
  # Mix.target() == Electric.MixProject.telemetry_target()
  @telemetry_enabled? true

  Logger.info("Compiling electric with telemetry_enabled: #{@telemetry_enabled?}")

  defmacro __using__(_opts) do
    quote do
      import Electric.Telemetry
    end
  end

  defmacro with_telemetry(module, do: block, else: else_block) do
    include_wity_telemetry(__ENV__, module, block, else_block)
  end

  defmacro with_telemetry(module, do: block) do
    include_wity_telemetry(__ENV__, module, block, nil)
  end

  if @telemetry_enabled? do
    defp include_wity_telemetry(env, module, block, else_block) do
      modules = List.wrap(module) |> Enum.map(&Macro.expand(&1, env))
      available? = Enum.all?(modules, &Code.ensure_loaded?/1)
      dbg({modules, available?})

      if available? do
        quote(do: unquote(block))
      else
        if else_block, do: quote(do: unquote(else_block))
      end
    end
  else
    defp include_wity_telemetry(_env, _module, _block, else_block) do
      if else_block, do: quote(do: unquote(else_block))
    end
  end

  @spec enabled?() :: boolean()
  def enabled? do
    @telemetry_enabled?
  end
end
