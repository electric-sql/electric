defmodule Electric.Publisher do
  def publish(pids, message) do
    # Based on OTP GenServer.call, see: https://github.com/erlang/otp/blob/090c308d7c925e154240685174addaa516ea2f69/lib/stdlib/src/gen.erl#L243
    pids
    |> Enum.map(fn pid ->
      ref = Process.monitor(pid)
      send(pid, {:"$gen_call", {self(), ref}, message})
      ref
    end)
    |> Enum.map(fn ref ->
      receive do
        {^ref, _reply} ->
          Process.demonitor(ref, [:flush])
          :ok

        {:DOWN, ^ref, _, _, _reason} ->
          :ok
      end
    end)
  end
end
