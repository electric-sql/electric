defmodule Electric.Connection.Manager.ConnectionBackoffTest do
  use ExUnit.Case
  alias Electric.Connection.Manager.ConnectionBackoff

  describe "total_retry_time/1" do
    test "returns 0 when no failures present" do
      backoff = ConnectionBackoff.init(100, :infinity)
      assert ConnectionBackoff.total_retry_time(backoff) == 0
    end

    test "returns elapsed time since first failure" do
      backoff = ConnectionBackoff.init(100, :infinity)
      {_time, failed_backoff} = ConnectionBackoff.fail(backoff)

      # Simulate some delay
      Process.sleep(50)
      assert ConnectionBackoff.total_retry_time(failed_backoff) >= 50
    end

    test "resets to 0 after succeed/1" do
      backoff = ConnectionBackoff.init(100, :infinity)
      {_time, failed_backoff} = ConnectionBackoff.fail(backoff)

      # Simulate some delay
      Process.sleep(50)
      assert ConnectionBackoff.total_retry_time(failed_backoff) >= 50
      {_retry_time, reset_backoff} = ConnectionBackoff.succeed(failed_backoff)

      assert ConnectionBackoff.total_retry_time(reset_backoff) == 0
    end
  end
end
