defmodule Electric.PollWait do
  @moduledoc """
  Per-process bounded polling of a cheap (ETS-backed) condition.

  `until/3` sleeps between checks with exponential backoff (doubling, capped)
  and bounded jitter so concurrent waiters land on distinct ETS reads
  instead of stampeding the same millisecond window.

  All defaults can be overridden per-call so the primitive can be shared
  between consumers with very different latency profiles.
  """

  @default_initial_interval 25
  @default_max_interval 500
  @default_backoff 2.0
  @default_jitter 0.25

  @type ready :: :ready | {:ready, term()}
  @type check :: (-> ready | :not_ready)

  @spec until(check, timeout(), keyword()) :: ready | :timeout
  def until(check_fun, timeout, opts \\ []) when is_function(check_fun, 0) do
    initial = Keyword.get(opts, :initial_interval, @default_initial_interval)
    max = Keyword.get(opts, :max_interval, @default_max_interval)
    factor = Keyword.get(opts, :backoff, @default_backoff)
    jitter = Keyword.get(opts, :jitter, @default_jitter)

    do_until(check_fun, deadline(timeout), initial, max, factor, jitter)
  end

  defp deadline(:infinity), do: :infinity

  defp deadline(t) when is_integer(t) and t >= 0,
    do: System.monotonic_time(:millisecond) + t

  defp do_until(check_fun, deadline, interval, max, factor, jitter) do
    case check_fun.() do
      :not_ready ->
        case remaining(deadline) do
          0 ->
            :timeout

          rem ->
            sleep_for = min(jittered(interval, jitter), rem)
            Process.sleep(sleep_for)

            next_interval = min(round(interval * factor), max)
            do_until(check_fun, deadline, next_interval, max, factor, jitter)
        end

      ready ->
        ready
    end
  end

  # Returns interval ± jitter*interval, clamped to >= 10ms so we never busy-loop.
  defp jittered(interval, jitter) when jitter <= 0.0, do: max(10, interval)

  defp jittered(interval, jitter) do
    spread = max(1, round(interval * jitter))
    # :rand.uniform(N) returns 1..N. Centre around 0 by subtracting spread+1.
    offset = :rand.uniform(2 * spread + 1) - spread - 1
    max(1, interval + offset)
  end

  defp remaining(:infinity), do: :infinity

  defp remaining(deadline),
    do: max(0, deadline - System.monotonic_time(:millisecond))
end
