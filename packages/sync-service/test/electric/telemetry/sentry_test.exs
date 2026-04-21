if Electric.telemetry_enabled?() and Code.ensure_loaded?(Sentry.LoggerHandler) do
  defmodule Electric.Telemetry.SentryTest do
    use ExUnit.Case, async: false

    alias Electric.Telemetry.Sentry, as: ElectricSentry

    # A dedicated handler id per test keeps state isolated and prevents
    # interference with any handler that may have been added elsewhere.
    setup do
      id = :"sentry_test_#{System.unique_integer([:positive])}"
      on_exit(fn -> _ = :logger.remove_handler(id) end)
      {:ok, handler_id: id}
    end

    defp handler_config!(id) do
      {:ok, %{config: config}} = :logger.get_handler_config(id)
      config
    end

    describe "add_logger_handler/1" do
      test "installs Sentry.LoggerHandler with default config", %{handler_id: id} do
        assert :ok = ElectricSentry.add_logger_handler(id: id)

        {:ok, handler} = :logger.get_handler_config(id)
        assert handler.module == Sentry.LoggerHandler

        assert %{metadata: :all, capture_log_messages: true, level: :error} =
                 handler_config!(id)
      end

      test "merges caller-supplied options into the handler config",
           %{handler_id: id} do
        assert :ok =
                 ElectricSentry.add_logger_handler(
                   id: id,
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
        assert :ok = ElectricSentry.add_logger_handler(id: id, level: :warning)

        assert %{level: :warning} = handler_config!(id)
      end

      test "accepts an empty option list and uses the default handler id" do
        default_id = :electric_sentry_handler
        _ = :logger.remove_handler(default_id)
        on_exit(fn -> _ = :logger.remove_handler(default_id) end)

        assert :ok = ElectricSentry.add_logger_handler()

        {:ok, handler} = :logger.get_handler_config(default_id)
        assert handler.module == Sentry.LoggerHandler
      end
    end
  end
end
