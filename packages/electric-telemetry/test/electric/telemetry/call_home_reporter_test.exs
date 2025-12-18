defmodule ElectricTelemetry.CallHomeReporterTest do
  use ExUnit.Case, async: true

  @telemetry_opts [
    instance_id: "test-instance_id",
    stack_id: "test-stack",
    version: "test-version",
    reporters: [
      call_home_url: "...fill this in inside the test case when bypass.port is known..."
    ],
    call_home_reporter_opts: [first_report_in: {1, :millisecond}]
  ]

  setup do
    bypass = Bypass.open()
    %{bypass: bypass, telemetry_opts: telemetry_opts(bypass)}
  end

  test "reports all expected info when started under ApplicationTelemetry", ctx do
    add_bypass_expectation(ctx, fn report ->
      # We assert the shape of the entire report here but values aren't valid since not enough
      # time has passed during the test execution to gather the data.
      assert %{
               "data" => %{
                 "electric_version" => "test-version",
                 "environment" => %{
                   "arch" => _,
                   "cores" => _,
                   "electric_installation_id" => "electric_default",
                   "electric_instance_id" => "test-instance_id",
                   "os" => _,
                   "ram" => _
                 },
                 "resources" => %{
                   "run_queue_cpu" => %{"max" => _, "mean" => _, "min" => _},
                   "run_queue_io" => %{"max" => _, "mean" => _, "min" => _},
                   "run_queue_total" => %{"max" => _, "mean" => _, "min" => _},
                   "uptime" => _,
                   "used_memory" => %{"max" => _, "mean" => _, "min" => _}
                 },
                 "system" => %{
                   "load_avg1" => _,
                   "load_avg15" => _,
                   "load_avg5" => _,
                   "memory_free" => _,
                   "memory_free_percent" => _,
                   "memory_used" => _,
                   "memory_used_percent" => _,
                   "swap_free" => _,
                   "swap_free_percent" => _,
                   "swap_used" => _,
                   "swap_used_percent" => _
                 }
               },
               "last_reported" => _,
               "report_version" => _,
               "timestamp" => _
             } = report
    end)

    start_supervised!({ElectricTelemetry.ApplicationTelemetry, ctx.telemetry_opts})

    assert_receive :bypass_done, 500
  end

  test "reports all expected info when started under StackTelemetry", ctx do
    add_bypass_expectation(ctx, fn report ->
      # We assert the shape of the entire report here but values aren't valid since not enough
      # time has passed during the test execution to gather the data.
      assert %{
               "data" => %{
                 "electric_version" => "test-version",
                 "environment" => %{
                   "arch" => _,
                   "cores" => _,
                   "electric_installation_id" => "electric_default",
                   "electric_instance_id" => "test-instance_id",
                   "os" => _,
                   "pg_version" => _,
                   "ram" => _,
                   "stack_id" => "test-stack"
                 },
                 "usage" => %{
                   "active_shapes" => _,
                   "inbound_bytes" => _,
                   "inbound_operations" => _,
                   "inbound_transactions" => _,
                   "live_requests" => _,
                   "served_bytes" => _,
                   "stored_bytes" => _,
                   "stored_operations" => _,
                   "stored_transactions" => _,
                   "sync_requests" => _,
                   "total_shapes" => _,
                   "total_used_storage_kb" => _,
                   "unique_clients" => _,
                   "wal_size" => %{"max" => _, "mean" => _, "min" => _}
                 }
               },
               "last_reported" => _,
               "report_version" => _,
               "timestamp" => _
             } = report
    end)

    start_supervised!({ElectricTelemetry.StackTelemetry, ctx.telemetry_opts})

    assert_receive :bypass_done, 500
  end

  defp add_bypass_expectation(%{bypass: bypass, telemetry_opts: telemetry_opts}, test_specific_fn) do
    test_pid = self()

    Bypass.expect(bypass, "POST", "/checkpoint", fn conn ->
      assert {"content-type", "application/json"} in conn.req_headers
      assert {:ok, body, conn} = Plug.Conn.read_body(conn)

      report = :json.decode(body)

      assert_call_home_report_common_fields(report, telemetry_opts)
      test_specific_fn.(report)

      send(test_pid, :bypass_done)

      Plug.Conn.send_resp(conn, 200, "")
    end)
  end

  defp telemetry_opts(bypass) do
    # CallHomeReporter can work with both a string and a URI struct
    url = "http://localhost:#{bypass.port}/checkpoint" |> maybe_parse_url()
    put_in(@telemetry_opts, [:reporters, :call_home_url], url)
  end

  defp maybe_parse_url(url) do
    if :rand.uniform(2) == 1 do
      URI.parse(url)
    else
      url
    end
  end

  def assert_call_home_report_common_fields(report, telemetry_opts) do
    # Extracting only those fields from the report that will be validated in this function.
    %{
      "data" => %{
        "environment" => %{
          "arch" => arch,
          "cores" => cores,
          "os" => %{"family" => "unix", "name" => os_name},
          "ram" => ram
        }
      },
      "last_reported" => last_reported,
      "report_version" => 2,
      "timestamp" => timestamp
    } = report

    # Execute CallHomeReporter.static_info() here to make the assertions resilient to platform
    # variations between different envinronments in which this test will run.
    static_info =
      telemetry_opts
      |> ElectricTelemetry.validate_options()
      |> then(fn {:ok, opts} ->
        ElectricTelemetry.Reporters.CallHomeReporter.static_info(opts)
      end)

    assert arch == static_info.environment.arch
    # If you get an assertion failure here when running the test suite on your dev
    # machine, please add your arch to the list.
    assert arch in ["x86_64-pc-linux-gnu"]

    assert cores == static_info.environment.cores
    assert is_integer(cores)
    assert cores >= 4

    assert os_name == to_string(static_info.environment.os.name)
    # If you get an assertion failure here, please add your OS name to the list.
    assert os_name in ["linux"]

    assert ram == static_info.environment.ram
    assert is_integer(ram)
    assert ram >= 4 * 1024 * 1024 * 1024

    assert {:ok, %DateTime{}, 0} = DateTime.from_iso8601(last_reported)
    assert {:ok, %DateTime{}, 0} = DateTime.from_iso8601(timestamp)
  end
end
