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

    test "includes documented top-level subset body params alongside query params" do
      conn =
        Plug.Test.conn(:post, "/v1/shape?foo=bar")
        |> Plug.Conn.fetch_query_params()
        |> Plug.Conn.assign(:body_params, %{
          "where" => "value ILIKE $1",
          "limit" => 1,
          "offset" => 0,
          "tags" => ["a", 2, nil],
          "table" => "items",
          "skip_me" => nil
        })

      attrs = Utils.common_open_telemetry_attrs(conn)

      assert attrs["http.query_param.foo"] == "bar"
      assert attrs["http.body_param.subset.where"] == "value ILIKE $1"
      assert attrs["http.body_param.subset.limit"] == 1
      assert attrs["http.body_param.subset.offset"] == 0
      refute Map.has_key?(attrs, "http.body_param.table")
      refute Map.has_key?(attrs, "http.body_param.subset.params")
      refute Map.has_key?(attrs, "http.body_param.subset.tags")
      refute Map.has_key?(attrs, "http.body_param.skip_me")
    end

    test "treats top-level subset body params as subset telemetry attrs" do
      conn =
        Plug.Test.conn(:post, "/v1/shape")
        |> Plug.Conn.fetch_query_params()
        |> Plug.Conn.assign(:body_params, %{
          "where" => "value ILIKE $1",
          "limit" => 1,
          "offset" => 0
        })

      attrs = Utils.common_open_telemetry_attrs(conn)

      assert attrs["http.body_param.subset.where"] == "value ILIKE $1"
      assert attrs["http.body_param.subset.limit"] == 1
      assert attrs["http.body_param.subset.offset"] == 0
      refute Map.has_key?(attrs, "http.body_param.where")
    end

    test "truncates large body param strings to 2000 bytes and keeps valid UTF-8" do
      long_value = String.duplicate("😀", 20_000)

      conn =
        Plug.Test.conn(:post, "/v1/shape")
        |> Plug.Conn.fetch_query_params()
        |> Plug.Conn.assign(:body_params, %{
          "where" => long_value
        })

      attrs = Utils.common_open_telemetry_attrs(conn)
      truncated = attrs["http.body_param.subset.where"]

      assert String.valid?(truncated)
      assert byte_size(truncated) <= 2000
      assert byte_size(truncated) < byte_size(long_value)
      assert String.starts_with?(long_value, truncated)
    end

    test "ignores non-subset top-level POST body params" do
      conn =
        Plug.Test.conn(:post, "/v1/shape")
        |> Plug.Conn.fetch_query_params()
        |> Plug.Conn.assign(:body_params, %{
          "table" => "items",
          "params" => %{"tenant" => "acme"}
        })

      attrs = Utils.common_open_telemetry_attrs(conn)

      refute Map.has_key?(attrs, "http.body_param.table")
      refute Map.has_key?(attrs, "http.body_param.subset.params")
      refute Map.has_key?(attrs, "http.body_param.subset.params")
      refute Enum.any?(Map.keys(attrs), fn key ->
               is_binary(key) and String.starts_with?(key, "http.body_param.")
             end)
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
