defmodule Electric.Plug.UtilsTest do
  alias Electric.Plug.Utils
  alias OpenTelemetry.SemConv, as: SC

  use ExUnit.Case, async: true
  doctest Utils, import: true

  describe "redact_query_string/1" do
    test "redacts sensitive query params while preserving order and flags" do
      assert Utils.redact_query_string(
               "table=users&secret=hunter2&flag&Token=abc123&offset=-1&token"
             ) ==
               "table=users&secret=[REDACTED]&flag&Token=[REDACTED]&offset=-1&token"
    end

    test "redacts empty sensitive values and encoded sensitive keys" do
      assert Utils.redact_query_string(
               "secret=&api_secret=legacy&access%5Ftoken=abc&api_key=123&password=swordfish"
             ) ==
               "secret=[REDACTED]&api_secret=[REDACTED]&access%5Ftoken=[REDACTED]&api_key=[REDACTED]&password=[REDACTED]"
    end
  end

  describe "common_open_telemetry_attrs/1" do
    test "redacts query string, url.full and per-param attributes consistently" do
      conn =
        Plug.Test.conn(
          "GET",
          "/v1/shape?table=users&secret=hunter2&api_secret=legacy&Token=abc123&flag&offset=-1&api_key=123"
        )
        |> Plug.Conn.fetch_query_params()
        |> Plug.Conn.assign(:plug_request_id, "req-123")

      attrs = Utils.common_open_telemetry_attrs(conn)

      assert attrs["http.query_string"] ==
               "table=users&secret=[REDACTED]&api_secret=[REDACTED]&Token=[REDACTED]&flag&offset=-1&api_key=[REDACTED]"

      assert attrs[SC.URLAttributes.url_full()] ==
               "http://www.example.com/v1/shape?table=users&secret=[REDACTED]&api_secret=[REDACTED]&Token=[REDACTED]&flag&offset=-1&api_key=[REDACTED]"

      assert attrs["http.query_param.secret"] == "[REDACTED]"
      assert attrs["http.query_param.api_secret"] == "[REDACTED]"
      assert attrs["http.query_param.Token"] == "[REDACTED]"
      assert attrs["http.query_param.api_key"] == "[REDACTED]"
      assert attrs["http.query_param.table"] == "users"
      assert attrs["http.query_param.offset"] == "-1"
      assert attrs["http.query_param.flag"] == ""
    end
  end

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
