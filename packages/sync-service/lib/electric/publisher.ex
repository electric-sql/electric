defmodule Electric.Publisher do
  @doc """
  Calls many GenServers asynchronously with the same message and waits for their responses before returning.

  Returns `:ok` once all GenServers have responded or have died.

  There is no timeout so if the GenServers do not respond or die, this function will block indefinitely.

  This function is similar to `GenServer.multi_call/4` however it is more performant as the message is not copied to an middleman process.
  `GenServer.multi_call/4` requires this middleman process to avoid late answers (after the timeout) from polluting the caller's message queue,
  however since `Publisher.publish/2` does not have a timeout, it does not need to use a middleman process.
  """
  def publish(pids, message) do
    # Based on OTP GenServer.call, see: https://github.com/erlang/otp/blob/090c308d7c925e154240685174addaa516ea2f69/lib/stdlib/src/gen.erl#L243
    pids
    |> Enum.map(fn pid ->
      ref = Process.monitor(pid)
      send(pid, {:"$gen_call", {self(), ref}, message})
      ref
    end)
    |> Enum.each(fn ref ->
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
