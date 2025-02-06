defmodule Electric.Connection.Manager.ConnectionBackoff do
  @type connection_backoff :: %{
          backoff: :backoff.backoff(),
          retries_started_at: nil | integer()
        }

  @spec init(pos_integer(), :infinity | pos_integer()) :: connection_backoff()
  def init(start, max),
    do: %{backoff: :backoff.init(start, max), retries_started_at: nil}

  @spec succeed(connection_backoff()) :: {pos_integer(), connection_backoff()}
  def succeed(%{backoff: backoff} = conn_backoff) do
    {_, backoff} = :backoff.succeed(backoff)

    {total_retry_time(conn_backoff), %{backoff: backoff, retries_started_at: nil}}
  end

  @spec fail(connection_backoff()) :: {pos_integer(), connection_backoff()}
  def fail(%{backoff: backoff, retries_started_at: retries_started_at}) do
    {time, backoff} = :backoff.fail(backoff)

    {time,
     %{
       backoff: backoff,
       retries_started_at: retries_started_at || System.monotonic_time(:millisecond)
     }}
  end

  @spec total_retry_time(connection_backoff()) :: pos_integer()
  def total_retry_time(%{retries_started_at: nil}),
    do: 0

  def total_retry_time(%{retries_started_at: retries_started_at}),
    do: System.monotonic_time(:millisecond) - retries_started_at
end
