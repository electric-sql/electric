defmodule Electric.Plug.SubsetTelemetryTest do
  use ExUnit.Case, async: false
  use Repatch.ExUnit

  import Plug.Test
  import Support.ComponentSetup
  import Support.DbSetup
  import Support.DbStructureSetup

  alias Electric.Plug.Router
  alias Electric.Telemetry.OpenTelemetry

  @moduletag :tmp_dir

  setup [:with_unique_db, :with_basic_tables, :with_sql_execute]
  setup :with_complete_stack

  setup(ctx) do
    :ok = Electric.StatusMonitor.wait_until_active(ctx.stack_id, timeout: 1000)
    %{opts: Router.init(build_router_opts(ctx))}
  end

  @tag with_sql: [
         "INSERT INTO items VALUES (gen_random_uuid(), 'test value 1')",
         "INSERT INTO items VALUES (gen_random_uuid(), 'test value 2')"
       ]
  test "adds POST body attrs and subset query attrs for POST subset requests", ctx do
    test_pid = self()

    Repatch.patch(OpenTelemetry, :add_span_attributes, [mode: :shared], fn attrs ->
      if is_map(attrs) and
           (Map.has_key?(attrs, "subset.rows") or
              Map.has_key?(attrs, "http.body_param.subset.where")) do
        send(test_pid, {:subset_span_attrs, attrs})
      end

      true
    end)

    conn =
      conn(
        "POST",
        "/v1/shape?table=items&offset=-1&log=changes_only",
        Jason.encode!(%{
          "subset" => %{
            "where" => "value ILIKE $1",
            "params" => %{"1" => "%2"},
            "limit" => 1,
            "offset" => 0,
            "order_by" => "value ASC"
          }
        })
      )
      |> Plug.Conn.put_req_header("content-type", "application/json")
      |> Router.call(ctx.opts)

    assert conn.status == 200

    assert %{
             "data" => [
               %{
                 "value" => %{"value" => "test value 2"}
               }
             ]
           } = Jason.decode!(conn.resp_body)

    assert_receive {:subset_span_attrs, attrs1}
    assert_receive {:subset_span_attrs, attrs2}
    refute_receive {:subset_span_attrs, _other}

    {request_attrs, query_attrs} =
      case {Map.has_key?(attrs1, "http.body_param.subset.where"),
            Map.has_key?(attrs2, "http.body_param.subset.where")} do
        {true, false} -> {attrs1, attrs2}
        {false, true} -> {attrs2, attrs1}
      end

    assert request_attrs["http.body_param.subset.limit"] == 1
    assert request_attrs["http.body_param.subset.offset"] == 0
    assert request_attrs["http.body_param.subset.where"] == "value ILIKE $1"

    assert query_attrs["subset.rows"] == 1
    assert query_attrs["subset.result_bytes"] > 0
  end

  test "truncates large POST body strings to 256 bytes in telemetry attrs", ctx do
    test_pid = self()
    long_value = String.duplicate("a", 300)

    Repatch.patch(OpenTelemetry, :add_span_attributes, [mode: :shared], fn attrs ->
      if is_map(attrs) and Map.has_key?(attrs, "http.body_param.subset.params.1") do
        send(test_pid, {:body_attrs, attrs})
      end

      true
    end)

    conn =
      conn(
        "POST",
        "/v1/shape?table=items&offset=-1&log=changes_only",
        Jason.encode!(%{
          "subset" => %{
            "where" => "value ILIKE $1",
            "params" => %{"1" => long_value}
          }
        })
      )
      |> Plug.Conn.put_req_header("content-type", "application/json")
      |> Router.call(ctx.opts)

    assert conn.status == 200
    assert_receive {:body_attrs, attrs}
    assert byte_size(attrs["http.body_param.subset.params.1"]) == 256
    assert attrs["http.body_param.subset.params.1"] == binary_part(long_value, 0, 256)
  end
end
