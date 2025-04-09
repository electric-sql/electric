defmodule Support.RepatchExt do
  def called_within_ms?(module, function, args, ms) do
    called_within_ms?(module, function, args, ms, System.monotonic_time(:millisecond))
  end

  defp called_within_ms?(module, function, args, ms, start_time) do
    cond do
      System.monotonic_time(:millisecond) - start_time > ms ->
        false

      Repatch.called?(module, function, args, by: :any) ->
        true

      true ->
        Process.sleep(1)
        called_within_ms?(module, function, args, ms, start_time)
    end
  end
end
