if Electric.telemetry_enabled?() and Code.ensure_loaded?(Sentry.LoggerHandler) do
  defmodule Electric.Telemetry.SentryTest do
    # async: false because :logger handler state is VM-global — unique ids per
    # test avoid name collisions but not the add/remove race across processes.
    use ExUnit.Case, async: false

    alias Electric.Telemetry.Sentry, as: ElectricSentry

    setup do
      id = :"sentry_test_#{System.unique_integer([:positive])}"
      on_exit(fn -> _ = :logger.remove_handler(id) end)
      {:ok, handler_id: id}
    end

    defp handler_config!(id) do
      {:ok, %{config: config}} = :logger.get_handler_config(id)
      config
    end

    describe "add_logger_handler/2" do
      test "installs Sentry.LoggerHandler with default config", %{handler_id: id} do
        assert :ok = ElectricSentry.add_logger_handler(id)

        {:ok, handler} = :logger.get_handler_config(id)
        assert handler.module == Sentry.LoggerHandler

        assert %{metadata: :all, capture_log_messages: true, level: :error} =
                 handler_config!(id)
      end

      test "merges caller-supplied options into the handler config",
           %{handler_id: id} do
        assert :ok =
                 ElectricSentry.add_logger_handler(id,
                   discard_threshold: 2000,
                   sync_threshold: nil
                 )

        assert %{
                 metadata: :all,
                 capture_log_messages: true,
                 level: :error,
                 discard_threshold: 2000,
                 sync_threshold: nil
               } = handler_config!(id)
      end

      test "caller-supplied options override defaults", %{handler_id: id} do
        assert :ok = ElectricSentry.add_logger_handler(id, level: :warning)

        assert %{level: :warning} = handler_config!(id)
      end

      test "uses the default handler id when called with no arguments" do
        default_id = ElectricSentry.default_handler_id()
        _ = :logger.remove_handler(default_id)
        on_exit(fn -> _ = :logger.remove_handler(default_id) end)

        assert :ok = ElectricSentry.add_logger_handler()

        {:ok, handler} = :logger.get_handler_config(default_id)
        assert handler.module == Sentry.LoggerHandler
      end
    end
  end
end
