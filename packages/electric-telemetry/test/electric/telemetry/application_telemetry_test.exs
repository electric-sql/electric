defmodule ElectricTelemetry.ApplicationTelemetryTest do
  use ExUnit.Case, async: true

  describe "get_system_memory_usage" do
    test "returns calculated memory stats" do
      case :os.type() do
        {:unix, :darwin} ->
          assert %{
                   total_memory: _,
                   available_memory: _,
                   free_memory: _,
                   used_memory: _,
                   resident_memory: _
                 } = ElectricTelemetry.ApplicationTelemetry.get_system_memory_usage(%{})

        _ ->
          assert %{
                   total_memory: _,
                   available_memory: _,
                   buffered_memory: _,
                   cached_memory: _,
                   free_memory: _,
                   used_memory: _,
                   resident_memory: _,
                   total_swap: _,
                   free_swap: _,
                   used_swap: _
                 } = ElectricTelemetry.ApplicationTelemetry.get_system_memory_usage(%{})
      end
    end
  end

  describe "CallHomeReporter" do
    test "includes all relevant info in its reports" do
      bypass = Bypass.open()

      telemetry_opts =
        [
          instance_id: "test-instance_id",
          version: "test-version",
          reporters: [call_home_url: "http://localhost:#{bypass.port}/checkpoint"],
          call_home_reporter_opts: [first_report_in: {1, :millisecond}]
        ]

      setup_bypass_expectation(bypass, telemetry_opts)

      start_supervised!({ElectricTelemetry.ApplicationTelemetry, telemetry_opts})

      assert_receive :bypass_done
    end
  end

  defp setup_bypass_expectation(bypass, telemetry_opts) do
    test_pid = self()

    Bypass.expect(bypass, "POST", "/checkpoint", fn conn ->
      assert {"content-type", "application/json"} in conn.req_headers
      assert {:ok, body, conn} = Plug.Conn.read_body(conn)

      # Execute CallHomeReporter.static_info() here to make the test resilient to platform
      # variations between different envinronments in which this test will run.
      static_info =
        telemetry_opts
        |> ElectricTelemetry.validate_options()
        |> then(fn {:ok, opts} ->
          ElectricTelemetry.Reporters.CallHomeReporter.static_info(opts)
        end)

      assert %{
               "data" => %{
                 "electric_version" => "test-version",
                 "environment" => %{
                   "arch" => arch,
                   "cores" => cores,
                   "electric_installation_id" => "electric_default",
                   "electric_instance_id" => "test-instance_id",
                   "os" => %{"family" => "unix", "name" => os_name},
                   "ram" => ram
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
               "last_reported" => last_reported,
               "report_version" => 2,
               "timestamp" => timestamp
             } = :json.decode(body)

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

      send(test_pid, :bypass_done)

      Plug.Conn.send_resp(conn, 200, "")
    end)
  end
end
