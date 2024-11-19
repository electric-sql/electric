defmodule Electric.Plug.UtilsTest do
  alias Electric.Plug.Utils
  use ExUnit.Case, async: true
  doctest Utils, import: true

  describe "get_next_interval_timestamp/2" do
    test "returns expected interval" do
      long_poll_timeout_ms = 20000
      long_poll_timeout_sec = div(long_poll_timeout_ms, 1000)
      # Calculate the expected next interval
      now = DateTime.utc_now()
      oct9th2024 = DateTime.from_naive!(~N[2024-10-09 00:00:00], "Etc/UTC")
      diff_in_seconds = DateTime.diff(now, oct9th2024, :second)
      expected_interval = ceil(diff_in_seconds / long_poll_timeout_sec) * long_poll_timeout_sec

      # Assert that the function returns the expected value
      assert Utils.get_next_interval_timestamp(long_poll_timeout_ms) ==
               expected_interval
    end

    test "returns expected inteval with different timeout" do
      long_poll_timeout_ms = 30000
      long_poll_timeout_sec = div(long_poll_timeout_ms, 1000)

      # Calculate the expected next interval
      now = DateTime.utc_now()
      oct9th2024 = DateTime.from_naive!(~N[2024-10-09 00:00:00], "Etc/UTC")
      diff_in_seconds = DateTime.diff(now, oct9th2024, :second)
      expected_interval = ceil(diff_in_seconds / long_poll_timeout_sec) * long_poll_timeout_sec

      # Assert that the function returns the expected value
      assert Utils.get_next_interval_timestamp(long_poll_timeout_ms) ==
               expected_interval
    end

    test "returns expected interval with different timeout and cursor collision" do
      long_poll_timeout_ms = 30000
      long_poll_timeout_sec = div(long_poll_timeout_ms, 1000)

      # Calculate the expected next interval
      now = DateTime.utc_now()
      oct9th2024 = DateTime.from_naive!(~N[2024-10-09 00:00:00], "Etc/UTC")
      diff_in_seconds = DateTime.diff(now, oct9th2024, :second)
      expected_interval = ceil(diff_in_seconds / long_poll_timeout_sec) * long_poll_timeout_sec

      # Assert that the function returns a DIFFERENT value due to collision
      assert Utils.get_next_interval_timestamp(
               long_poll_timeout_ms,
               "#{expected_interval}"
             ) != expected_interval
    end
  end
end
