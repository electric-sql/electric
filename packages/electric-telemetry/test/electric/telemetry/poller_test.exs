defmodule ElectricTelemetry.PollerTest do
  use ExUnit.Case, async: true

  import ExUnit.CaptureLog

  alias ElectricTelemetry.Poller

  defmodule Fixture do
    def ok(), do: :done
    def raise_argument(), do: raise(ArgumentError, "boom")
    def raise_runtime(), do: raise(RuntimeError, "kaboom")
    def exit_noproc(), do: exit({:noproc, {GenServer, :call, [:nowhere, :hi]}})
    def exit_timeout(), do: exit({:timeout, {GenServer, :call, [:slow, :hi]}})
    def exit_shutdown(), do: exit({:shutdown, :foo})
    def exit_normal_atom(), do: exit(:normal)
    def exit_shutdown_atom(), do: exit(:shutdown)
    def exit_weird(), do: exit(:weird)
    def throw_it(), do: throw(:nope)
  end

  describe "safe_invoke/3" do
    test "returns :ok and runs the function on success" do
      assert Poller.safe_invoke(Fixture, :ok, []) == :ok
    end

    test "swallows ArgumentError (ETS missing, etc.) silently" do
      log = capture_log(fn -> assert Poller.safe_invoke(Fixture, :raise_argument, []) == :ok end)
      refute log =~ "crashed"
    end

    test "swallows generic exceptions with a warning" do
      log = capture_log(fn -> assert Poller.safe_invoke(Fixture, :raise_runtime, []) == :ok end)
      assert log =~ "crashed"
      assert log =~ "kaboom"
    end

    test "swallows :noproc exit silently" do
      log = capture_log(fn -> assert Poller.safe_invoke(Fixture, :exit_noproc, []) == :ok end)
      refute log =~ "exit"
    end

    test "swallows :timeout exit silently" do
      log = capture_log(fn -> assert Poller.safe_invoke(Fixture, :exit_timeout, []) == :ok end)
      refute log =~ "exit"
    end

    test "swallows :shutdown exit silently" do
      log = capture_log(fn -> assert Poller.safe_invoke(Fixture, :exit_shutdown, []) == :ok end)
      refute log =~ "exit"
    end

    test "swallows bare :normal exit silently" do
      log =
        capture_log(fn -> assert Poller.safe_invoke(Fixture, :exit_normal_atom, []) == :ok end)

      refute log =~ "exit"
    end

    test "swallows bare :shutdown exit silently" do
      log =
        capture_log(fn -> assert Poller.safe_invoke(Fixture, :exit_shutdown_atom, []) == :ok end)

      refute log =~ "exit"
    end

    test "logs a warning for unexpected exits" do
      log = capture_log(fn -> assert Poller.safe_invoke(Fixture, :exit_weird, []) == :ok end)
      assert log =~ "exit"
      assert log =~ "weird"
    end

    test "logs a warning for throws" do
      log = capture_log(fn -> assert Poller.safe_invoke(Fixture, :throw_it, []) == :ok end)
      assert log =~ "throw"
    end
  end

  describe "periodic_measurements/2 wrapping" do
    defmodule CallbackMod do
      @behaviour ElectricTelemetry.Poller
      def builtin_periodic_measurements(_opts), do: []
      def some_measurement(_opts), do: :ok
    end

    test "wraps {m, f, a} tuples in safe_invoke" do
      opts = %{periodic_measurements: [{CallbackMod, :some_measurement, []}]}

      assert [{ElectricTelemetry.Poller, :safe_invoke, [CallbackMod, :some_measurement, [_]]}] =
               Poller.periodic_measurements(opts, CallbackMod)
    end

    test "wraps bare function atoms in safe_invoke" do
      opts = %{periodic_measurements: [:some_measurement]}

      assert [{ElectricTelemetry.Poller, :safe_invoke, [CallbackMod, :some_measurement, [_]]}] =
               Poller.periodic_measurements(opts, CallbackMod)
    end

    test "wraps anonymous functions in safe_invoke around user_measurement" do
      f = fn _ -> :ok end
      opts = %{periodic_measurements: [f]}

      assert [
               {ElectricTelemetry.Poller, :safe_invoke,
                [ElectricTelemetry.Poller, :user_measurement, [^f, _]]}
             ] =
               Poller.periodic_measurements(opts, CallbackMod)
    end

    test "leaves telemetry_poller builtins unwrapped" do
      opts = %{periodic_measurements: [:memory, :persistent_term]}
      assert Poller.periodic_measurements(opts, CallbackMod) == [:memory, :persistent_term]
    end
  end
end
