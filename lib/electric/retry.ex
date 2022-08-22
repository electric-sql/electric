defmodule Electric.Retry do
  defmacro retry_while(opts, do_block \\ []) do
    code = Keyword.get(opts, :do, Keyword.fetch!(do_block, :do))
    start_backoff = Keyword.get(opts, :start_backoff, 10)
    max_single_backoff = Keyword.get(opts, :max_single_backoff, 1000)
    total_timeout = Keyword.get(opts, :total_timeout, 10000)

    quote do
      Stream.unfold(
        unquote(start_backoff),
        &{&1, :backoff.rand_increment(&1, unquote(max_single_backoff))}
      )
      |> Stream.transform(0, fn
        elem, acc when acc > unquote(total_timeout) -> {:halt, acc}
        elem, acc -> {[elem], acc + elem}
      end)
      |> Enum.reduce_while(nil, fn timeout, _ ->
        result = unquote(code)

        case result do
          {:cont, value} ->
            Process.sleep(timeout)
            {:cont, value}

          {:halt, value} ->
            {:halt, value}
        end
      end)
    end
  end
end
