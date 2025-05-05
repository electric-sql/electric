defmodule Electric.Shapes.ShapeCleanerTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.ShapeCleaner

  import Support.ComponentSetup
  alias Support.Mock

  import Mox

  setup :verify_on_exit!
  setup :with_stack_id_from_test

  describe "monitors and cleans shapes" do
    setup ctx do
      {:ok, cleaner} =
        start_supervised(
          {ShapeCleaner,
           stack_id: ctx.stack_id,
           publication_manager: {Mock.PublicationManager, []},
           storage: {Mock.Storage, []},
           shape_status: Mock.ShapeStatus}
        )

      {:ok, cleaner: cleaner, shape_handle: "test_shape_#{ctx.stack_id}"}
    end

    test "handles cleanup of unexpected consumer shutdown",
         %{cleaner: cleaner, shape_handle: shape_handle} = ctx do
      Mock.ShapeStatus
      |> stub(:shape_definition, fn _, _ -> {:ok, %{}} end)
      |> expect(:remove_shape, 1, fn _, _ -> :ok end)
      |> allow(self(), cleaner)

      Mock.PublicationManager
      |> expect(:remove_shape_async, 1, fn _, _ -> :ok end)
      |> allow(self(), cleaner)

      {:ok, pid} = start_mock_consumer(ctx)

      assert :ok =
               ShapeCleaner.monitor_shape(shape_handle, server: cleaner, stack_id: ctx.stack_id)

      # ensure consumer is killed
      on_exit(fn -> Process.alive?(pid) && Process.exit(pid, :kill) end)
      Process.unlink(pid)
      Process.exit(pid, :bad_reason)

      # give some time to process messages
      Process.sleep(10)
    end

    test "ignore expected consumer shutdowns",
         %{cleaner: cleaner, shape_handle: shape_handle} = ctx do
      Mock.ShapeStatus
      |> stub(:shape_definition, fn _, _ -> {:ok, %{}} end)
      |> expect(:remove_shape, 0, fn _, _ -> :ok end)
      |> allow(self(), cleaner)

      Mock.PublicationManager
      |> expect(:remove_shape_async, 0, fn _, _ -> :ok end)
      |> allow(self(), cleaner)

      {:ok, pid} = start_mock_consumer(ctx)

      assert :ok =
               ShapeCleaner.monitor_shape(shape_handle, server: cleaner, stack_id: ctx.stack_id)

      # ensure consumer is killed
      on_exit(fn -> Process.alive?(pid) && Process.exit(pid, :kill) end)
      Process.unlink(pid)
      Process.exit(pid, :normal)

      # give some time to process messages
      Process.sleep(10)
    end

    test "ensure shape is cleaned up if consumer dead",
         %{cleaner: cleaner, shape_handle: shape_handle} = ctx do
      Mock.ShapeStatus
      |> expect(:remove_shape, 1, fn _, _ -> :ok end)
      |> allow(self(), cleaner)

      assert :ok =
               ShapeCleaner.ensure_shape_cleanup(shape_handle,
                 server: cleaner,
                 stack_id: ctx.stack_id
               )

      # give some time to process messages
      Process.sleep(10)
    end

    test "fails to ensure shape is cleaned up if consumer alive",
         %{cleaner: cleaner, shape_handle: shape_handle} = ctx do
      Mock.ShapeStatus
      |> expect(:remove_shape, 0, fn _, _ -> :ok end)
      |> allow(self(), cleaner)

      {:ok, _pid} = start_mock_consumer(ctx)

      assert {:error,
              "Expected shape #{shape_handle} consumer to not be alive before cleaning shape"} ==
               ShapeCleaner.ensure_shape_cleanup(shape_handle,
                 server: cleaner,
                 stack_id: ctx.stack_id
               )
    end
  end

  defp start_mock_consumer(ctx) do
    GenServer.start_link(__MODULE__.MockConsumer, [],
      name: Electric.Shapes.Consumer.name(ctx.stack_id, ctx.shape_handle)
    )
  end

  defmodule __MODULE__.MockConsumer do
    use GenServer

    def init(_opts) do
      {:ok, %{}}
    end
  end
end
