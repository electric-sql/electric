defmodule Electric.Utils.GenStage do
  @moduledoc """
  Helpers that wrap GenStage functionality and messages to write custom stages.
  """

  @doc """
  Subscribe self to a GenStage producer, awaiting the producer process if `:to` option
  is a `gproc` via-tuple.
  """
  @spec gproc_subscribe_self!(GenStage.subscription_options(), non_neg_integer()) ::
          {pid(), reference()}
  def gproc_subscribe_self!(opts, await_timeout \\ 5_000)
      when is_integer(await_timeout) or await_timeout == :infinity do
    {to, opts} =
      Keyword.pop_lazy(opts, :to, fn ->
        raise ArgumentError, "expected :to argument in async_(re)subscribe"
      end)

    pid =
      case to do
        {:via, :gproc, gproc_spec} ->
          {pid, _} = :gproc.await(gproc_spec, await_timeout)
          pid

        non_gproc ->
          pid = GenServer.whereis(non_gproc)

          pid ||
            raise RuntimeError,
              message:
                "GenStage consumer #{inspect(self())} was not able to subscribe to the process #{inspect(to)} because that process is not alive"
      end

    sub_ref = Process.monitor(pid)
    msg = {:"$gen_producer", {self(), sub_ref}, {:subscribe, nil, opts}}

    Process.send(pid, msg, [])

    {pid, sub_ref}
  end

  # copied from GenStage.ask/3, but form is defined as opaque there :/
  @spec ask({Process.dest(), reference()}, pos_integer(), [:noconnect | :nosuspend]) ::
          :noconnect | :nosuspend | :ok
  def ask({pid, ref}, demand, opts \\ []) when is_integer(demand) and demand > 0 do
    Process.send(pid, {:"$gen_producer", {self(), ref}, {:ask, demand}}, opts)
  end
end
